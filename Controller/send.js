// __Dependencies__
var es = require('event-stream');
var crypto = require('crypto');
var errors = require('../errors');

// __Private Module Members__
// A map that is used to create empty response body.
function empty (doc, callback) { callback(null, '') }
// Generate a respone Etag
function etag (response) {
  return es.map(function (doc, callback) {
    var hash = crypto.createHash('md5');
    var etag = response.get('Etag');
    if (etag) return callback(null, doc);
    hash.update(JSON.stringify(doc));
    response.set('Etag', '"' + hash.digest('hex') + '"');
    callback(null, doc);
  });
}
// Generate a Last-Modified header
function lastModified (response, lastModifiedPath) {
  return es.map(function (doc, callback) {
    if (!response.get('Last-Modified') && lastModifiedPath) {
      response.set('Last-Modified', doc.get(lastModifiedPath));
    }
    callback(null, doc);
  });
}
// Build a reduce stream.
function reduce (accumulated, f) {
  return es.through(
    function (doc) {
      accumulated = f(accumulated, doc);
    },
    function () {
      this.emit('data', accumulated);
      this.emit('end');
    }
  );
}
// Count emissions.
function count () {
  return reduce(0, function (a, b) { return a + 1 });
}

// __Module Definition__
var decorator = module.exports = function (options, protect) {
  var controller = this;

  function pipeline (request, stream) {
    if (!request.baucis.send) request.baucis.send = stream;
    else request.baucis.send = es.pipeline(request.baucis.send, stream);
  }

  // Create the basic stream.
  protect.finalize(function (request, response, next) {
    var count = 0;
    var documents = request.baucis.documents;

    // If documents were set in the baucis hash, use them.
    if (documents) documents = es.readArray([].concat(documents));
    // Otherwise, stream the relevant documents from Mongo, based on constructed query.
    else documents = request.baucis.query.stream();

    pipeline(request, documents);
    // Check for 404.
    pipeline(request, es.through(
      function (doc) {
        count += 1;
        this.emit('data', doc);
      },
      function () {
        if (count === 0) return this.emit('error', errors.NotFound());
        else return this.emit('end');
      }
    ));
    // Apply user streams.
    pipeline(request, request.baucis.outgoing());
    // Set the document formatter based on the Accept header of the request.
    request.baucis.api.formatters(response, function (error, formatter) {
      if (error) next(error);
      request.baucis.formatter = formatter;
      next();
    });
  });

  // HEAD
  protect.finalize('instance', 'head', function (request, response, next) {
    var modified = controller.get('lastModified');
    if (modified) pipeline(request, lastModified(response, modified));
    pipeline(request, es.stringify());
    pipeline(request, etag(response));
    pipeline(request, es.map(empty));
    next();
  });

  protect.finalize('collection', 'head', function (request, response, next) {
    pipeline(request, es.map(empty));
    next();
  });

  // GET
  protect.finalize('instance', 'get', function (request, response, next) {
    var modified = controller.get('lastModified');
    if (modified) pipeline(request, lastModified(response, modified));
    pipeline(request, etag(response));
    pipeline(request, request.baucis.formatter());
    next();
  });

  protect.finalize('collection', 'get', function (request, response, next) {
    if (request.baucis.count) {
      pipeline(request, count());
      pipeline(request, es.stringify());
    }
    else {
      pipeline(request, request.baucis.formatter(true));
    }
    next();
  });

  // POST
  protect.finalize('collection', 'post', function (request, response, next) {
    pipeline(request, request.baucis.formatter());
    next();
  });

  // PUT
  protect.finalize('put', function (request, response, next) {
    pipeline(request, request.baucis.formatter());
    next();
  });

  // DELETE
  protect.finalize('del', function (request, response, next) {
    // Remove each document from the database.
    pipeline(request, es.map(function (doc, callback) {
      doc.remove(callback);
    }));
    pipeline(request, count());
    pipeline(request, es.stringify());
    next();
  });

  protect.finalize(function (request, response, next) {
    request.baucis.send.on('error', function (error) {
      if (error.message !== 'bad hint') return next(error);
      next(errors.BadRequest('The requested query hint is invalid'));
    });
    request.baucis.send.pipe(response);
  });
};

