var _ = require('lodash');
var moment = require('moment');

module.exports = {

  // options:
  //
  // `filters`: an object in which
  // each key is the name of a Nunjucks filter and
  // its corresponding value is a function that implements it.
  //
  // `language`: your own alternative to the object
  // returned by require('nunjucks'). Replacing Nunjucks
  // in Apostrophe would be a vast undertaking, but perhaps
  // you have a custom version of Nunjucks that is compatible.

  construct: function(self, options) {

    self.templateApos = {
      log: function(o) {
        console.log(o);
      }
    };
    self.filters = {};

    self.nunjucks = options.language || require('nunjucks');

    // Merge new properties onto the "apos" object seen
    // in Nunjucks templates. Used to add new convenience
    // methods to be called from templates. If you pass
    // an object, each property is merged onto the
    // apos object. If you pass a name and a value,
    // the named property is set.

    self.addToApos = function(object /* or name, value */) {
      if (typeof(object) === 'string') {
        self.templateApos[arguments[0]] = arguments[1];
      } else {
        _.merge(self.templateApos, object);
      }
    };

    self.addToApos({
      utils: require('./lib/nunjucksUtils.js')(self, options)
    });

    self.modulesReady = function() {
      return wrapFunctions(self.templateApos);
      function wrapFunctions(object) {
        _.each(object, function(value, key) {
          if (typeof(value) === 'object') {
            wrapFunctions(value);
          } else if (typeof(value) === 'function') {
            object[key] = function() {
              try {
                return value.apply(self, arguments);
              } catch (e) {
                console.error(e);
                console.error(e.stack);
                console.error('^^^^^ LOOK UP HERE FOR THE LOCATION WITHIN YOUR HELPER');
                throw e;
              }
            };
          }
        });
      }
    };

    // Add new filters to the Nunjucks environment. You
    // can add many by passing an object with named
    // properties, or add just one by passing a name
    // and a function. You can also do this through the
    // filters option of this module.

    self.addFilter = function(object /* or name, fn */) {
      if (typeof(object) === 'string') {
        self.filters[arguments[0]] = arguments[1];
      } else {
        _.extend(self.filters, object);
      }
    };

    // return a string which will not be escaped
    // by Nunjucks. Call this in your helper function
    // when your return value contains markup and you
    // are absolutely sure that any user input has
    // been correctly escaped already.

    self.safe = function(s) {
      return new self.nunjucks.runtime.SafeString(s);
    };

    // Load and render a Nunjucks template, internationalized
    // by the given req object. The template with the name
    // specified is loaded from the views folder of the
    // specified module or its superclasses; the deepest
    // version of the template wins. You normally won't call
    // this directly; you'll call self.render on your module.

    // Apostrophe Nunjucks helpers such as `apos.area` are
    // attached to the `apos` object in your template.

    // Data passed in your `data` object is provided as the
    // `data` object in your template, which also contains
    // properties of `req.data` and `module.templateData`,
    // if those objects exist.

    // If there is a conflict, your `data` argument wins,
    // followed by `req.data`.

    // The .html extension is assumed.

    self.renderForModule = function(req, name, data, module) {
      if (typeof(req) !== 'object') {
        throw new Error('The first argument to module.render must be req. If you are trying to implement a Nunjucks helper function, use module.partial.');
      }
      return self.renderBody(req, 'file', name, data, module);
    };

    // Works just like self.render, except that the
    // entire template is passed as a string rather than
    // a filename.

    self.renderStringForModule = function(req, s, data, module) {
      if (typeof(req) !== 'object') {
        throw new Error('The first argument to module.render must be req. If you are trying to implement a Nunjucks helper function, use module.partial.');
      }
      return self.renderBody(req, 'string', s, data, module);
    };

    self.partialForModule = function(name, data, module) {
      var req = self.contextReq;
      if (!req) {
        throw new Error('partial() must always be called from within a Nunjucks helper function invoked via a Nunjucks template. If you are rendering a template in your own route, use render() and pass req at the first argument.');
      }
      return self.safe(self.renderForModule(req, name, data, module));
    }

    self.partialStringForModule = function(name, data, module) {
      var req = self.contextReq;
      if (!req) {
        throw new Error('partialString() must always be called from within a Nunjucks helper function invoked via a Nunjucks template. If you are rendering a template in your own route, use renderString() and pass req at the first argument.');
      }
      return self.safe(self.renderStringForModule(req, name, data, module));
    }

    // Stringify the data as JSON, then escape any sequences
    // that would cause a <script> tag to end prematurely if
    // the JSON were embedded in it.

    self.jsonForHtml = function(data) {
      data = JSON.stringify(data); // , null, '  ');
      data = data.replace(/<\!\-\-/g, '<\\!--');
      data = data.replace(/<\/script\>/gi, '<\\/script>');
      return data;
    };

    // Implements `render` and `renderString`. See their
    // documentation.

    self.renderBody = function(req, type, s, data, module) {
      if (self.contextReq && (req !== self.contextReq)) {
        throw new Error('render() must not be called from a Nunjucks helper function nested inside another call to render(). Use partial() instead.');
      }

      try {
        // "OMG, a global variable?" Yes, it's safe for the
        // duration of a single synchronous render operation,
        // which allows partial() to be called without a req.
        //
        // However note that partialForModule calls
        // renderForModule, so we track the depth of
        // those calls to avoid clearing contextReq
        // prematurely

        if (!self.renderDepth) {
          self.renderDepth = 0;
          self.contextReq = req;
        }
        self.renderDepth++;

        if (!data) {
          data = {};
        }

        var args = {};

        args.data = data;
        args.apos = self.templateApos;
        args.__ = req.res.__;

        if (req.data) {
          _.defaults(data, req.data);
        }

        if (module.templateData) {
          _.defaults(data, module.templateData);
        }

        args.data.locale = args.data.locale || req.locale;

        var result;
        if (type === 'file') {
          var finalName = s;
          if (!finalName.match(/\.\w+$/)) {
            finalName += '.html';
          }
          result = self.getEnv(module).getTemplate(finalName).render(args);
        } else if (type === 'string') {
          result = self.getEnv(module).renderString(s, args);
        } else {
          throw new Error('renderBody does not support the type ' + type);
        }
      } catch (e) {
        self.renderDepth--;
        if (!self.renderDepth) {
          delete self.contextReq;
        }
        throw e;
      };
      self.renderDepth--;
      if (!self.renderDepth) {
        delete self.contextReq;
      }
      return result;
    };

    self.envs = {};

    // Fetch a nunjucks environment in which `include`,
    // `extends`, etc. search the views directories of the
    // specified module and its ancestors. Typically you
    // will call `self.render`, `self.renderPage` or
    // `self.partial` on your module object rather than calling
    // this directly.

    self.getEnv = function(module) {
      var name = module.__meta.name;

      // Cache for performance
      if (_.has(self.envs, name)) {
        return self.envs[name];
      }

      dirs = self.getViewFolders(module);

      self.envs[name] = self.newEnv(name, dirs);
      return self.envs[name];
    };

    self.getViewFolders = function(module) {
      var dirs = _.map(module.__meta.chain, function(entry) {
        return entry.dirname + '/views';
      });
      // Final class should win
      dirs.reverse();
      return dirs;
    };

    // Create a new nunjucks environment in which the
    // specified directories are searched for includes,
    // etc. Don't call this directly, use:
    //
    // apos.templates.getEnv(module)

    self.newEnv = function(moduleName, dirs) {

      var loader = self.newLoader(moduleName, dirs, undefined, self);

      var env = new self.nunjucks.Environment(loader, { autoescape: true });

      self.addStandardFilters(env);

      _.each(self.filters, function(filter, name) {
        env.addFilter(name, filter);
      });

      if (self.options.filters) {
        _.each(self.options.filters, function(filter, name) {
          env.addFilter(name, filter);
        });
      }

      return env;
    };

    // Creates a Nunjucks loader object for the specified
    // list of directories, which can also call back to
    // this module to resolve cross-module includes. You
    // will not need to call this directly.

    self.newLoader = function(moduleName, dirs) {
      var NunjucksLoader = require('./lib/nunjucksLoader.js');
      return new NunjucksLoader(moduleName, dirs, undefined, self);
    };

    self.addStandardFilters = function(env) {

      // Format the given date with the given momentjs
      // format string.

      env.addFilter('date', function(date, format) {
        // Nunjucks is generally highly tolerant of bad
        // or missing data. Continue this tradition by not
        // crashing if date is null. -Tom
        if (!date) {
          return '';
        }
        var s = moment(date).format(format);
        return s;
      });

      // Stringify the given data as a query string.

      env.addFilter('query', function(data) {
        return qs.stringify(data || {});
      });

      // Stringify the given data as JSON, with
      // additional escaping for safe inclusion
      // in a script tag.

      env.addFilter('json', function(data) {
        return self.jsonForHtml(data);
      });

      // Builds filter URLs. See the URLs module.

      env.addFilter('build', self.apos.urls.build);

      // Remove HTML tags from string, leaving only
      // the text. All lower case to match jinja2's naming.

      env.addFilter('striptags', function(data) {
        return data.replace(/(<([^>]+)>)/ig, "");
      });

      // Convert newlines to <br /> tags.
      env.addFilter('nlbr', function(data) {
        data = self.apos.utils.globalReplace(data, "\n", "<br />\n");
        return data;
      });

      // Convert the camelCasedString s to a hyphenated-string,
      // for use as a CSS class or similar.
      env.addFilter('css', function(s) {
        return self.apos.utils.cssName(s);
      });

      env.addFilter('pruneTemporaryProperties', function(o) {
        var copy = _.cloneDeep(o);
        self.apos.utils.pruneTemporaryProperties(copy);
        return copy;
      });

      // Output "data" as JSON, escaped to be safe in an
      // HTML attribute. By default it is escaped to be
      // included in an attribute quoted with double-quotes,
      // so all double-quotes in the output must be escaped.
      // If you quote your attribute with single-quotes
      // and pass { single: true } to this filter,
      // single-quotes in the output are escaped instead,
      // which uses dramatically less space and produces
      // more readable attributes.
      //
      // EXCEPTION: if the data is not an object or array,
      // it is output literally as a string. This takes
      // advantage of jQuery .data()'s ability to treat
      // data attributes that "smell like" objects and arrays
      // as such and take the rest literally.

      env.addFilter('jsonAttribute', function(data, options) {
        if (typeof(data) === 'object') {
          return self.apos.utils.escapeHtml(JSON.stringify(data), options);
        } else {
          // Make it a string for sure
          data += '';
          return self.apos.utils.escapeHtml(data, options);
        }
      });
    };

    // Typically you will call the `renderPage` method of
    // your own module, provided by the `apostrophe-module`
    // base class, which is a wrapper for this method.
    //
    // Generate a complete HTML page for transmission to the
    // browser.
    //
    // If `template` is a function it is passed a data object,
    // otherwise it is rendered as a nunjucks template relative
    // to this module via self.render.
    //
    // `data` is provided to the template, with additional
    // default properties as described below.
    //
    // `module` is the module from which the template should
    // be rendered, if an explicit module name is not part
    // of the template name.
    //
    // Additional properties merged with the `data object:
    //
    // "outerLayout" is set to...
    //
    // "apostrophe-templates:outerLayout.html"
    //
    // Or:
    //
    // "apostrophe-templates:refreshLayout.html"
    //
    // This allows the template to handle either a content area
    // refresh or a full page render just by doing this:
    //
    // {% extend outerLayout %}
    //
    // Note the lack of quotes.
    //
    // Under the following conditions, "refreshLayout.html"
    // is used in place of "outerLayout.html":
    //
    // req.xhr is true (always set on AJAX requests by jQuery)
    // req.query.xhr is set to simulate an AJAX request
    // req.decorate is false
    // req.query.apos_refresh is true
    //
    // These default properties are also provided:
    //
    // user (req.user)
    // query (req.query)
    // permissions (req.user.permissions)
    // calls (javascript markup to insert all global and
    //   request-specific calls pushed by server-side code)
    // data (javascript markup to insert all global and
    //   request-specific data pushed by server-side code)

    self.renderPageForModule = function(req, template, data, module) {
      // TODO bring this back as soon as we refactor the
      // permissions module so an object is there to receive
      // this property

      // req.browserCall('apos.permissions.current = ?',
      //   (req.user && req.user.permissions) || {}
      // );

      var scene = req.user ? 'user' : 'anon';
      var globalCalls = self.apos.push.getBrowserCalls('always');
      if (scene === 'user') {
        globalCalls += self.apos.push.getBrowserCalls('user');
      }

      // Always the last call; signifies we're done initializing the
      // page as far as the core is concerned; a lovely time for other
      // modules and project-level javascript to do their own
      // enhancements.
      //
      // This method emits a 'ready' event, and also
      // emits an 'enhance' event with the entire $body
      // as its argument.
      //
      // Waits for DOMready to give other
      // things maximum opportunity to happen.

      req.browserCall('apos.pageReady();');

      // JavaScript may want to know who the user is. Provide
      // just a conservative set of basics for security. Devs
      // who want to know more about the user in browserland
      // can push more data and it'll merge
      if (req.user) {
        req.browserCall('apos.user = ?;', _.pick('title', '_id', 'username'));
      }

      req.browserCall('apos.scene = ?', scene);

      var reqCalls = req.getBrowserCalls();

      var decorate = !(req.query.apos_refresh || req.query.xhr || req.xhr || (req.decorate === false));

      var args = {
        outerLayout: decorate ? 'apostrophe-templates:outerLayout.html' : 'apostrophe-templates:refreshLayout.html',
        user: req.user,
        permissions: (req.user && req.user.permissions) || {},
        when: req.user ? 'user' : 'anon',
        js: {
          globalCalls: self.safe(globalCalls),
          reqCalls: self.safe(reqCalls)
        },
        refreshing: req.query && (!!req.query.apos_refresh),
        // Make the query available to templates for easy access to
        // filter settings etc.
        query: req.query,
      };

      _.extend(args, data);

      try {
        if (typeof(template) === 'string') {
          content = module.render(req, template, args);
        } else {
          content = template(req, args);
        }
      } catch (e) {
        // The page template
        // threw an exception. Log where it
        // occurred for easier debugging
        return error(e, 'template');
      }

      return content;

      function error(e, type) {
        var now = Date.now();
        now = moment(now).format("YYYY-MM-DDTHH:mm:ssZZ");
        console.error(':: ' + now + ': ' + type + ' error at ' + req.url);
        console.error('Current user: ' + (req.user ? req.user.username : 'none'));
        console.error(e);
        req.statusCode = 500;
        return self.render(req, 'templateError');
      }
    };

    self.apos.templates = self;
  }
};