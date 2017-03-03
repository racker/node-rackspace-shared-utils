/*
 *  Copyright 2012 Rackspace
 *
 *  Licensed under the Apache License, Version 2.0 (the "License");
 *  you may not use this file except in compliance with the License.
 *  You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 *  Unless required by applicable law or agreed to in writing, software
 *  distributed under the License is distributed on an "AS IS" BASIS,
 *  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *  See the License for the specific language governing permissions and
 *  limitations under the License.
 *
 */

var util = require('util');
var assert = require('assert');
var wildcard = require('wildcard');
var Timer = require('metrics-ck').Timer;
var Counter = require('metrics-ck').Counter;
var Meter = require('metrics-ck').Meter;
var _ = require('underscore');
var StatsD = require('./statsd').StatsD;
var NullStatsD = require('./statsd').NullStatsD;


/**
 * Storage for live metrics.
 */
var workMetrics = {};
var eventMetrics = {};
var gauges = {};


/**
 * A statsd client used by all instrumentation calls. By default all calls are
 * noop, however by calling `configureStatsD` with a host and port this can be
 * replaced with a real statsd client that logs instrumentation to a statsd
 * server.
 */
var statsd = new NullStatsD();


/**
 * Used when metrics are disabled.
 */
function noop() {}


/**
 * Instantiate a work metric if it doesn't exist.
 * @param {String} label The metric to instantiate.
 */
function ensureWorkMetric(label) {
  if (!workMetrics[label]) {
    workMetrics[label] = {
      active: new Counter(),
      timer: new Timer(),
      errorMeter: new Meter()
    };
  }
}


/**
 * Cause instrumentation to be recorded to a statsd server, as well as the
 * standard in-memory recording. If no arguments are specified, drop stats.
 * @param {Number} port The UDP statsd port to send to.
 * @param {String} host The address to send to.
 * @return {StatsD} The configured statsd client. The user should handle any
 *     errors this emits.
 */
exports.configureStatsD = function(port, host) {
  statsd.close();
  if (port !== undefined) {
    statsd = new StatsD(port, host);
  } else {
    statsd = new NullStatsD();
  }

  return statsd;
};


/**
 * Record work directly, skipping active counter.
 * @param {String} label The label for the work.
 * @param {Number} duration The duration of the work in ms.
 * @callback {Function?} function Called after sending dgram, (optional), takes 'err' parameter.
 */
exports.measureWork = function(label, duration, callback) {
  ensureWorkMetric(label);
  workMetrics[label].timer.update(duration);
  statsd.incrementTimer(label, duration, callback);
};


/**
 * Record the occurrence of an event.
 * @param {String} label A label identifying the event.
 * @param {Number?} count The count to increment by. Defaults to 1.
 * @callback {Function?} function Called after sending dgram, (optional), takes 'err' parameter.
 */
exports.recordEvent = function(label, count, callback) {
  count = count || 1;

  if (!eventMetrics[label]) {
    eventMetrics[label] = new Meter();
  }

  eventMetrics[label].mark(count);
  statsd.incrementCounter(label, count, callback);
};


/**
 * Set a gauge.
 * @param {String} label The label of the gauge to set.
 * @callback {Function?} function Called after sending dgram, (optional), takes 'err' parameter.
 */
exports.setGauge = function(label, value, callback) {
  gauges[label] = value;
  statsd.setGauge(label, value, callback);
};


/**
 * Used to track when work starts/stops across method invocations.
 * @constructor
 * @param {string} label the metric that will be tracked.
 */
function Work(label) {
  this.label = label;
  this.startTime = null;
  this.stopTime = null;
  ensureWorkMetric(this.label);
}


/**
 * Start measuring work.
 */
Work.prototype.start = function() {
  this.startTime = Date.now();
  workMetrics[this.label].active.inc();
};


/**
 * Stop measuring work and record it.
 * @param {boolean} error Whether an error occurred.
 * @return {Number} Number of seconds between stop and start call.
 * @callback {Function?} function Called after sending dgram, (optional), takes 'err' parameter.
 */
Work.prototype.stop = function(error, callback) {
  var delta;

  this.stopTime = Date.now();

  delta = (this.stopTime - this.startTime);
  workMetrics[this.label].active.dec();
  workMetrics[this.label].timer.update(delta);

  if (error) {
    workMetrics[this.label].errorMeter.mark(1);
    statsd.incrementCounter(this.label + '__error', callback);
  } else {
    statsd.incrementTimer(this.label, delta, callback);
  }

  return delta;
};



/**
 * Dummy work object. Each method call is a no-op.
 * @constructor
 * @param {{string}} label the metric that will be tracked.
 */
function DummyWork(label) {}

util.inherits(DummyWork, Work);


/** no-op. */
DummyWork.prototype.start = noop;


/** no-op. */
DummyWork.prototype.stop = noop;


/**
 * Returns a function that will emit timers for a given asynchronous function when it is invoked.
 * This makes the assumption that the final argument passed to the returned function is a function.
 * @param {String} label The label for the timer.
 * @param {Function} handler The function to be timed.
 */
exports.timeAsyncFunction = function(label, handler) {
  return function() {
    var work = new Work(label),
        args = Array.prototype.slice.call(arguments),
        callback = args.pop();

    assert(typeof callback === 'function', 'A callback function is required when timing an async function.');

    args.push(function() {
      work.stop();
      callback.apply(null, arguments);
    });

    work.start();
    handler.apply(null, args);
  };
};


/**
 * Returns true if a work metric with the given label is being tracked.
 * @param {String} label The event to retrive metrics for.
 * @return {Bool}
 */
var hasWorkMetric = function(label) {
  return workMetrics.hasOwnProperty(label);
};


/**
 * Retrieve a specific work metric.
 * @param {String} label The label of the metric to retrieve.
 * @return {Object} The work metric data.
 */
exports.getWorkMetric = function(label) {
  var metric = workMetrics[label], pct;

  if (metric) {
    pct = metric.timer.percentiles([0.01, 0.25, 0.5, 0.75, 0.99, 0.999]);
    return {
      label: label,
      ops_count: metric.timer.count(),
      rate_1m: metric.timer.oneMinuteRate(),
      rate_5m: metric.timer.fiveMinuteRate(),
      rate_15m: metric.timer.fifteenMinuteRate(),
      mean_rate: metric.timer.meanRate(),
      min: metric.timer.min(),
      max: metric.timer.max(),
      mean_time: metric.timer.mean(),
      std_dev: metric.timer.stdDev(),
      pct_1: pct['0.01'],
      pct_25: pct['0.25'],
      pct_50: pct['0.5'],
      pct_75: pct['0.75'],
      pct_99: pct['0.99'],
      pct_999: pct['0.999'],
      active: metric.active.count,
      errors: metric.errorMeter.count,
      err_rate_1m: metric.errorMeter.oneMinuteRate(),
      err_rate_5m: metric.errorMeter.fiveMinuteRate(),
      err_rate_15m: metric.errorMeter.fifteenMinuteRate(),
      err_mean_rate: metric.errorMeter.meanRate()
    };
  } else {
    return {
      label: label,
      ops_count: 0,
      rate_1m: 0,
      rate_5m: 0,
      rate_15m: 0,
      mean_rate: 0,
      min: 0,
      max: 0,
      mean_time: 0,
      std_dev: 0,
      pct_1: 0,
      pct_25: 0,
      pct_50: 0,
      pct_75: 0,
      pct_99: 0,
      pct_999: 0,
      active: 0,
      errors: 0,
      err_rate_1m: 0,
      err_rate_5m: 0,
      err_rate_15m: 0,
      err_mean_rate: 0
    };
  }
};


/**
 * Get all work metrics.
 * @return {Array} A list of work metrics.
 */
exports.getWorkMetrics = function() {
  var metrics = [], key;

  for (key in workMetrics) {
    if (workMetrics.hasOwnProperty(key)) {
      metrics.push(exports.getWorkMetric(key));
    }
  }
  return metrics;
};


/**
 * Finds all work metrics matching the pattern.
 * @param {String} pattern wildcard to match with.
 * @return {Array} An array containing matching metric labels.
 */
exports.findWorkMetrics = function(pattern) {
  var self = this;
  return _.map(wildcard(pattern, workMetrics), function(value, label) {
    return label;
  });
};


/**
 * Returns true if an event metric with the given label is being tracked.
 * @param {String} label The event to retrive metrics for.
 * @return {Bool}
 */
var hasEventMetric = function(label) {
  return eventMetrics.hasOwnProperty(label);
};


/**
 * Retrieve metrics for a specific event.
 * @param {String} label The event to retrieve metrics for.
 * @return {Object} The event metric data.
 */
exports.getEventMetric = function(label) {
  var metric = eventMetrics[label];

  if (metric) {
    return {
      label: label,
      count: metric.count,
      rate_1m: metric.oneMinuteRate(),
      rate_5m: metric.fiveMinuteRate(),
      rate_15m: metric.fifteenMinuteRate(),
      rate_mean: metric.meanRate()
    };
  } else {
    return {
      label: label,
      count: 0,
      rate_1m: 0,
      rate_5m: 0,
      rate_15m: 0,
      rate_mean: 0
    };
  }
};


/**
 * Get all event metrics.
 * @return {Array} A list of event metrics.
 */
exports.getEventMetrics = function() {
  var metrics = [], key;

  for (key in eventMetrics) {
    if (eventMetrics.hasOwnProperty(key)) {
      metrics.push(exports.getEventMetric(key));
    }
  }
  return metrics;
};


/**
 * Finds all event metrics matching the pattern.
 * @param {String} pattern wildcard to match with.
 * @return {Array} An array containing matching metric labels.
 */
exports.findEventMetrics = function(pattern) {
  return _.map(wildcard(pattern, eventMetrics), function(value, label) {
    return label;
  });
};


/**
 * Returns true if an gauge metric with the given label is being tracked.
 * @param {String} label The event to retrive metrics for.
 * @return {Bool}
 */
var hasGaugeMetric = function(label) {
  return gauges.hasOwnProperty(label);
};


/**
 * Get a single gauge metric.
 * @param {String} label The label of the gauge to retrieve.
 * @return {Object} The gauge metric.
 */
exports.getGaugeMetric = function(label) {
  var value = gauges[label];

  if (value) {
    return {
      label: label,
      value: value
    };
  } else {
    return {
      label: label,
      value: 0
    };
  }
};


/**
 * Get all gauge metrics.
 * @return {Array} A list of all gauge metrics.
 */
exports.getGaugeMetrics = function() {
  var metrics = [], key;

  for (key in gauges) {
    if (gauges.hasOwnProperty(key)) {
      metrics.push(exports.getGaugeMetric(key));
    }
  }

  return metrics;
};


/**
 * Finds all gauges matching the pattern.
 * @param {String} pattern wildcard to match with.
 * @return {Array} An array containing matching metric labels.
 */
exports.findGaugeMetrics = function(pattern) {
  return _.map(wildcard(pattern, gauges), function(value, label) {
    return label;
  });
};


/**
 * Get all metrics. This is fairly expensive, if you know what you want then
 * you should get that directly.
 * @return {Object} A map of metric types to metric lists.
 */
exports.getMetrics = function() {
  return {
    work: exports.getWorkMetrics(),
    events: exports.getEventMetrics(),
    gauges: exports.getGaugeMetrics()
  };
};


/** the work function. */
exports.Work = Work;


/** DummyWork class. */
exports.DummyWork = DummyWork;


/**
 * The metrics library calls setInterval but never clears it. This causes
 * tests, among other things, to hang. Traverse the object hierarchy, find the
 * interval (which has a specific name) and clear it.
 * @param {Object} obj The object to clear intervals from.
 */
function clearStrayIntervals(obj) {
  var field;

  for (field in obj) {
    if (field === '0') {
      continue;
    } else if (field === 'tickInterval') {
      clearInterval(obj[field]);
    } else {
      clearStrayIntervals(obj[field]);
    }
  }
}


/**
 * Release resources being used to track an operation.
 * @param {String} label A label identifying which resources to release.
 */
exports.releaseWork = function(label) {
  clearStrayIntervals(workMetrics[label].timer);
  clearStrayIntervals(workMetrics[label].errorMeter);
  delete workMetrics[label];
};


/**
 * Release resources being used to track an event.
 * @param {String} label A label identifying which resources to release.
 */
exports.releaseEvent = function(label) {
  clearStrayIntervals(eventMetrics[label]);
  delete eventMetrics[label];
};


/**
 * Release resources being used to track a gauge.
 * @param {String} label The label of the gauge to free.
 */
exports.releaseGauge = function(label) {
  delete gauges[label];
};


/**
 * Release all resources.
 *
 * @param {Function} callback the completion callback.
 */
exports.shutdown = function(callback) {
  var label;

  callback = callback || noop;

  for (label in workMetrics) {
    if (workMetrics.hasOwnProperty(label)) {
      exports.releaseWork(label);
    }
  }

  for (label in eventMetrics) {
    if (eventMetrics.hasOwnProperty(label)) {
      exports.releaseEvent(label);
    }
  }

  for (label in gauges) {
    if (gauges.hasOwnProperty(label)) {
      exports.releaseGauge(label);
    }
  }

  exports.configureStatsD();

  callback();
};


/**
 * RecordWork type.
 * Upon instantiation of this object, two metrics will be created.
 * A recordEvent metric will be emitted to count the operation.
 * A timer metric is created and timed, and will be completed when the mutated
 * callback is invoked.
 * @param {String} label Label of metric to record and time.
 * @param {Function} callback A callback function to be mutated.
 */
var RecordWork = function(label, callback) {
  this.work = new Work(label);
  this.callback = callback;

  exports.recordEvent(label);
};


/**
 * getCallback function.
 * Returns a mutated version of the callback the object was instantiated with.
 * @return {Function} Mutated callback that stops the work timer.
 */
RecordWork.prototype.getCallback = function() {
  var that = this;

  return function() {
    var args = Array.prototype.slice.call(arguments);
    that.stopWork(args[0]);
    that.callback.apply(null, args);
  };
};


/**
 * startWork function.
 * Starts a StatsD work timer, and returns itself for chaining
 * @return {RecordWork} Returns itself.
 */
RecordWork.prototype.startWork = function() {
  this.work.start();

  return this;
};


/**
 * stopWork function.
 * Manually stop a work timer.
 * @param {boolean} error Whether an error occurred.
 */
RecordWork.prototype.stopWork = function(err) {
  this.work.stop(err);
};


/** export RecordWork type. */
exports.RecordWork = RecordWork;


/** export testFunctions. */
exports.testFunctions = {
  hasEventMetric: hasEventMetric,
  hasWorkMetric: hasWorkMetric,
  hasGaugeMetric: hasGaugeMetric
};


/*
 * RunningGauge.
 * Emits a running count as a statsd gauge. Starting value defaults to 0.
 * @param {String} label The label of the statsd gauge.
 * @param {Number} startingValue The starting value of a gauge.
 * @constructor
 */
var RunningGauge = function(label, startingValue) {
  this.label = label;
  this.startingValue = startingValue;
  this.count = this.startingValue || 0;
  exports.setGauge(this.label, this.count);
};


/**
 * Emits the newly incremented count as a gauge. If val isn't provided, 1 is used.
 * @param {Number} val The amount to increment the gauge.
 */
RunningGauge.prototype.incr = function(val) {
  this.count += (typeof val === 'number' ? val : 1);
  exports.setGauge(this.label, this.count);
};


/*
 * Emits the newly decremented count as a gauge. If val isn't provided, -1 is used.
 * @param {Number} val The amount to decrement the gauge by.
 */
RunningGauge.prototype.decr = function(val) {
  this.count += (typeof val === 'number' ? val * -1 : -1);
  exports.setGauge(this.label, this.count);
};


/**
 * Reset the running count. If val isn't provided, this will default to the starting value
 * provided on instantiation.
 * @param {Number} val The number to rest the running count to..
 */
RunningGauge.prototype.reset = function(val) {
  this.count = val || this.startingValue;
  exports.setGauge(this.label, this.count);
};


/* RunningGauge export */
exports.RunningGauge = RunningGauge;
