var uuid = require('uuid');

module.exports = function (options, logger) {
  options = options || {}
  logger = logger || options.logger

  if (!logger && options.constructor && options.constructor.name === 'Logger') {
    logger = options
    options = {}
  }

  if (!logger) {
    throw new Error('`logger` is required')
  }

  let headerName = options.headerName || 'X-Request-Id';
  let headerNameLower = headerName.toLowerCase();
  let propertyName = options.propertyName || 'reqId';
  let additionalRequestFinishData = options.additionalRequestFinishData;
  let logName = options.logName || 'req_id';
  let obscureHeaders = options.obscureHeaders;
  let requestStart = options.requestStart || false;
  let verbose = options.verbose || false;
  let parentRequestSerializer = logger.serializers && logger.serializers.req;
  let level = options.level || 'info';
  let obscureBody = options.obscureBody || ['password'];

  if (obscureHeaders && obscureHeaders.length) {
    obscureHeaders = obscureHeaders.map(function (name) {
      return name.toLowerCase()
    })
  } else {
    obscureHeaders = false
  }

  function obscure(obj, keys) {
    var obscuredObj = {};
    Object.keys(obj).forEach(function(name) {
      obscuredObj[name] = keys.includes(name) ? 'FILTERED' : obj[name];
    })

    return obscuredObj;
  }

  function requestSerializer(req) {
    var obj
    if (parentRequestSerializer) {
      obj = parentRequestSerializer(req)
    } else {
      obj = {
        method: req.method, 
        url: req.originalUrl || req.url,
        headers: req.headers, 
        query: req.query,
        remoteAddress: req.connection.remoteAddress,
        remotePort: req.connection.remotePort,
        body: req.body
      }
    }

    if (obscureHeaders && obj.headers) {
      obj.headers = obscure(obj.headers, obscureHeaders);
    }

    if (obscureBody && obj.body) {
      obj.body = obscure(obj.body, obscureBody);
    }

    return obj
  }

  logger = logger.child(
    { serializers:
      { req: requestSerializer
      , res: logger.serializers && logger.serializers.res || logger.constructor.stdSerializers.res
      }
    }
  )

  return function (req, res, next) {
    var id = req[propertyName]
          || req.headers[headerNameLower]
          || uuid.v4()

    var start = process.hrtime()

    var prefs = {}
    prefs[logName] = id
    req.log = res.log = logger.child(prefs, true)

    req[propertyName] = res[propertyName] = id
    res.setHeader(headerName, id)

    if (requestStart || verbose) {
      var reqStartData = { req: req }
      if (verbose) reqStartData.res = res
      req.log[level](reqStartData, 'request start')
    }
    res.on('finish', function() {
      var reqFinishData =
        { res: res
        , duration: getDuration(start)
        }
      if (!requestStart || verbose) reqFinishData.req = req
      if (additionalRequestFinishData) {
        var additionReqFinishData = additionalRequestFinishData(req, res)
        if (additionReqFinishData) {
          Object.keys(additionReqFinishData).forEach(function(name) {
            reqFinishData[name] = additionReqFinishData[name]
          })
        }
      }
      res.log[level](reqFinishData, 'request finish')
    })
    res.on('close', function () {
      res.log.warn(
          { req: req
          , res: res
          , duration: getDuration(start)
          }
        , 'request socket closed'
        )
    })

    next()
  }
}

function getDuration(start) {
  var diff = process.hrtime(start)
  return diff[0] * 1e3 + diff[1] * 1e-6
}
