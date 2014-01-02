/*---------------------------------------------------------------
 :: sails-odata
 -> adapter
 ---------------------------------------------------------------*/

var request = require('request')
    , _ = require('lodash')
    , uri;

var adapter = module.exports = {
    syncable: false,
    defaults: {
        port: 3306,
        host: 'localhost',
        path: '/api/'
    },
    registerCollection: function (collection, cb) {
        uri = collection.config.host + ':' + collection.config.port + collection.config.path;
        cb();
    },
    create: function (collectionName, values, cb) {
        request.post({ uri: uri + collectionName, json: values }, fnWrap(cb));
    },
    find: function (collectionName, options, cb) {
        if (options.where && options.where.id) {
            request({uri: uri + collectionName + '/' + options.where.id, json: {}}, fnWrap(function (err, body) {
                if (err) cb(err);
                cb(null, [body]);
            }));
        } else {
            var qs = oDataQueryString(options) || '';
            request({uri: uri + collectionName + qs, json: {}}, fnWrap(function (err, body) {
                if (err) cb(err);
                cb(null, body.d.results);
            }));
        }
    },
    update: function (collectionName, options, values, cb) {

        if (options.where && options.where.id) {
            this.request({uri: uri + collectionName + '/' + options.where.id, json: data}, fnWrap(cb));
        }
        // TODO: have the ability to perform a mass update given a query.
    },
    destroy: function (collectionName, options, cb) {
        if (options.where && options.where.id) {
            request.del({uri: uri + collectionName + '/' + options.where.id, json: {}}, fnWrap(cb));
        }
        // TODO: have the ability to perform a mass delete given a query.
    },
    count: function (collectionName, options, cb) {
        options.count = true;
        options.limit = 0;
        var qs = oDataQueryString(options) || '?$inlinecount=allpages';
        request({uri: uri + collectionName + qs, json: {}}, fnWrap(function (err, body) {
            if (err) cb(err);
            cb(null, body.d.__count);
        }));
    }
};

function fnWrap(next) {
    return function (err, resp, body) {
        if (!err && ~~(resp.statusCode / 100) === 2) {
            next(null, body);
        } else {
            var error = {
                type: 'api',
                err: err || body && resp.statusCode && resp.statusCode + ": " + (body.Message || body) + " - " + resp.req.method + ": " + resp.req.collection || body && body.Message || resp.statusCode,
                resp: resp,
                body: body
            };
            next(error);
        }
    };
}

function oDataQueryString(options) {
    console.log(options);
    var qs = {
        $skip: options.skip || 0,
        $top: options.limit || 25
    };
    if (options.where)
        qs.$filter = oDataFilterString(options.where);
    if (options.sort) {
        qs.$orderby = options.sort.replace(/(\s[a-zA-Z]+)$/, function ($0) {
            return $0.toLowerCase();
        });
    }
    if (options.count)
        qs.$inlinecount = 'allpages';
    // The querystring builder that converts an object will replace dollar signs '$' with '%24' which will cause 
    // problems. We don't want that so we simply build a string to return.
    var queryArr = [];
    for (var key in qs) {
        if (qs[key] !== undefined && qs[key] !== null)
            queryArr.push(key + '=' + qs[key]);
    }
    var querystring = "?" + queryArr.join('&');
    console.log(querystring);
    return querystring;
}

var operators = {
    'and': function (value) {
        var tmpArr = [];
        _.forEach(value, function (val) {
            tmpArr.push(oDataFilterString(val));
        });
        return '(' + tmpArr.join(' and ') + ')';
    },
    'or': function (value) {
        var tmpArr = [];
        _.forEach(value, function (val) {
            tmpArr.push(oDataFilterString(val));
        });
        return '(' + tmpArr.join(' or ') + ')';
    },
    '!': function (value,key) {
        this.not(value,key);
    },
    'not': function (value,key) {
        if(_.isString(escapeValue(value)))
            return key + ' ne ' + escapeValue(value);
        return 'not (' + oDataFilterString(value) + ')'
    },
    'like': function (value, key) {
        return this.contains(value, key);
    },
    '<': function (value, key) {
        return key + 'lt ' + escapeValue(value);
    },
    '>': function (value, key) {
        return key + 'gt ' + escapeValue(value);
    },
    '<=': function (value, key) {
        return key + 'le ' + escapeValue(value);
    },
    '>=': function (value, key) {
        return key + 'ge ' + escapeValue(value);
    },
    '=':function(value,key){
        return key + ' eq ' + escapeValue(value);
    },
    'startsWith': function (value, key) {
        return 'startswith(' + key + ', ' + escapeValue(value) + ') eq true';
    },
    'endsWith': function (value, key) {
        return 'endswith(' + key + ', ' + escapeValue(value) + ') eq true';
    },
    'contains': function (value, key) {
        return 'substringof(' + escapeValue(value) + ', ' + key + ') eq true';
    },
    'field': function (v, k) {
        var tmpArr = [];
        if (_.isObject(v)) {
            tmpArr = [];
            _.forIn(v, function (value, key) {
                tmpArr.push((operators[key] || operators.field)(value, k));
            });
            return operators.or(tmpArr);
        } else if (_.isArray(filter)) {
            tmpArr = [];
            _.forEach(v, function (value) {
                tmpArr.push(operators['='](value, k));
            });
            return operators.or(tmpArr);
        }else{
            return operators['='](v, k);
        }
    }
};

function escapeValue(value){
    value = parseValue(value);
    if (_.isString(value))
        return "'" + value + "'";
    return value;
}

function parseValue(value) {
    if (!_.isNaN(Date.parse(value)))
        return Date(value);
    else if (value === "false")
        return false;
    else if (value === "true")
        return true;
    else if (/^-?([0-9]*(\.[0-9]+)?|Infinity)$/.test(value) && !_.isNaN(_.parseInt(value)))
        return _.parseInt(value);
    else
        return value;
}

function oDataFilterString(filter) {
    if (_.isObject(filter)) {
        var filterString = "";
        _.forIn(filter, function (value, key) {
            filterString += (operators[key] || operators.field)(value, key);
        });
        return filterString;
    } else if (_.isArray(filter)) {
        return operators.or(filter); // not sure if filter will ever be an array here...
    } else
        return filter;
}
