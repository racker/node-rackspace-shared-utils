var misc = require('./misc');

['errors', 'flow_control', 'fs', 'instruments', 'misc', 'request'].forEach(function(module) {
  var name = misc.toCamelCase(module);
  exports[name] = require('./' + module);
});
