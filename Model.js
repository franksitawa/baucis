var deco = require('deco');
var mongoose = require('mongoose');
var pluralize = require('mongoose/lib/utils').toCollectionName;
var BaucisError = require('./BaucisError');

var Model = module.exports = deco(function (options, protect) {
  var model = this;

  protect.property('singular');
  protect.property('plural');
  protect.property('locking', false);
  protect.property('lastModified');

  model.deselected = function (path) {
    var deselected = [];
    // Store naming, model, and schema.
    // Find deselected paths in the schema.
    model.schema.eachPath(function (name, path) {
      if (path.options.select === false) deselected.push(name);
    });
    if (arguments.length === 0) return deselected;
    else return (deselected.indexOf(path) !== -1);
  };

  console.log(model.modelName)
  model.singular(model.modelName);
  model.plural(pluralize(model.singular()));
});

// Wrap the mongoose model function to add this mixin.
var originalMongooseModel = mongoose.model;
mongoose.model = function () {
  var m = originalMongooseModel.apply(mongoose, arguments);
  if (!m.singular) Model.apply(m);
  return m;
};
