/**
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

var dgram = require('dgram');
var events = require('events');
var util = require('util');



/**
 * A statsd, blindly fire metric updates to statsd over UDP.
 * @constructor
 * @param {Number} port The UDP port to send stats to.
 * @param {String} host The host to send stats to.
 */
function StatsD(port, host) {
  var self = this;
  this.port = port;
  this.host = host;
  this.client = dgram.createSocket('udp4');
  this.client.on('error', function(err) {
    self.emit('error', err);
  });
}

util.inherits(StatsD, events.EventEmitter);


/**
 * Increment a statsd counter by 1.
 * @param {String} key The key of the counter to increment.
 * @param {Number?} value The value to increment the counter by. Defaults to 1.
 * @callback {Function?} function Called after sending dgram, (optional), takes 'err' parameter.
 */
StatsD.prototype.incrementCounter = function(key, count, callback) {
  count = count || 1;
  this._send(new Buffer(key + ':' + count + '|c'), callback);
};


/**
 * Increment a statsd timer by a specified duration.
 * @param {String} key The key of the timer to increment.
 * @param {Number} ms The number of milliseconds to record.
 * @callback {Function?} function Called after sending dgram, (optional), takes 'err' parameter.
 */
StatsD.prototype.incrementTimer = function(key, ms, callback) {
  this._send(new Buffer(key + ':' + ms + '|ms'), callback);
};


/**
 * Set a gauge to the specified value.
 * @param {String} key The key of the gauge to set.
 * @param {Number} value The value to which to set the gauge.
 * @callback {Function?} function Called after sending dgram, (optional), takes 'err' parameter.
 */
StatsD.prototype.setGauge = function(key, value, callback) {
  this._send(new Buffer(key + ':' + value + '|g'), callback);
};


/**
 * Send a buffer to the target address.
 * @param {Buffer} data The buffer to send.
 * @callback {Function?} function Called after sending dgram, (optional), takes 'err' parameter.
 */
StatsD.prototype._send = function(data, callback) {
  try {
    this.client.send(data, 0, data.length, this.port, this.host, callback);
  } catch (e) {
    // Node's lovely udp client can throw in a few scenarios
    this.emit('error', e);
  }
};


/**
 * Close the statsd client.
 */
StatsD.prototype.close = function() {
  this.client.close();
};



/**
 * Used when statsd recording is disabled.
 * @constructor
 */
function NullStatsD() { }

util.inherits(NullStatsD, StatsD);

function handleCallback(k, v, callback) {
  if (callback) {
    callback();
  }
}

/**
 * Pretend to increment a counter.
 */
NullStatsD.prototype.incrementCounter = handleCallback;


/**
 * Pretend to increment a timer.
 */
NullStatsD.prototype.incrementTimer = handleCallback;


/**
 * Pretend to set a gauge.
 */
NullStatsD.prototype.setGauge = handleCallback;


/**
 * Pretend to close the client.
 */
NullStatsD.prototype.close = function() {};


exports.StatsD = StatsD;
exports.NullStatsD = NullStatsD;
