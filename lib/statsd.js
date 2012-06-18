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
var util = require('util');



/**
 * A statsd, blindly fire metric updates to statsd over UDP.
 * @constructor
 * @param {Number} port The UDP port to send stats to.
 * @param {String} host The host to send stats to.
 */
function StatsD(port, host) {
  this.port = port;
  this.host = host;
  this.client = dgram.createSocket('upd4');
}


/**
 * Increment a statsd counter by 1.
 * @param {String} key The key of the counter to increment.
 */
StatsD.prototype.incrementCounter = function(key) {
  var data = new Buffer(key + ':1|c');
  this.client.send(data, 0, data.length, this.port, this.host);
};


/**
 * Increment a statsd timer by a specified duration.
 * @param {String} key The key of the timer to increment.
 * @param {Number} millis The number of ms to record.
 */
StatsD.prototype.incrementTimer = function(key, millis) {
  var data = new Buffer(key + ':' + millis + '|ms');
  this.client.send(data, 0, data.length, this.port, this.host);
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
function DummyStatsD() { }

util.inherits(DummyStatsD, StatsD);


/**
 * Pretend to increment a counter.
 */
DummyStatsD.prototype.incrementCounter = function() {};


/**
 * Pretend to increment a timer.
 */
DummyStatsD.prototype.incrementTimer = function() {};


/**
 * Pretend to close the client.
 */
DummyStatsD.prototype.close = function() {};


exports.StatsD = StatsD;
exports.DummyStatsD = DummyStatsD;
