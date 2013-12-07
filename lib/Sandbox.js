/// <reference path="../Other/Backbone.custom.js" />
/// <reference path="../Other/lodash.custom.js" />
/// <reference path="../RideSharkGoogleMapsControl.Dev3.js" />



//App - Page level application control and functionality. Handles global requests in a namespaced manner, as well as
//          pub-sub/mediator integration.
//
(function () {

    // Initial Setup
    // -------------

    // Save a reference to the global object (`window` in the browser, `exports`
    // on the server).
    var root = this;


    // The top-level namespace. All public classes and modules will
    // be attached to this.
    var App;


    if (typeof exports !== 'undefined') {
        App = exports;
    } else {
        App = root.App = {};
    }

    var Backbone = root.Backbone;



    var array = [];
    var push = array.push;
    var slice = array.slice;
    var splice = array.splice;


    //Add a number of methods from Backbone.Model to handle getting and setting of various global variables.




    var SandboxModule = function (module) {
        this.requires = module.requires;
        this.provides = module.provides;
        this.module = module;
        this.initialized = false;
        //Active - What is used.
        this.active = true;
        this.actions = module.actions;
    }

    _.extend(SandboxModule.prototype, {
        updateRequirements: function (names) {
            ///<summary>Called by Sandbox.approve, alerts the sandbox module as to what has been approved by other modules, so it can start up.</summary>
            if (this.initialized) { return; }

            var values;
            if (_.isArray(names)) {
                values = names;
            } else {
                values = [];
                values.push(names);
            }

            this.requires = _.difference(this.requires, values);
            this.start();
        },

        start: function () {
            ///<summary>Called by Sandbox.start, initializes this SandboxModule and the actual module if all requirements are met.</summary>
            if (!this.initialized && this.requires.length == 0) {
                this.initialized = true;
                this.module.configure(this.module._options);
            }
        },
        isActive:function()
        {
            return (this.module.active === true);
        },

        //Perform a role if active
        perform: function (action, args) {
            if (this.active && this.actions[action]) {
                if (this.module.active) {
                    this.module[this.actions[action]].apply(this.module, args);
                }
            }
        }
    });


    var Sandbox = App.Sandbox = function (attributes, options) {
        ///<summary>The core of the mediator methodology. Handles instantiation, "global" variables, event firing, and communication between different modules.</summary>


        var defaults;
        var attrs = attributes || {};
        options || (options = {});
        this.cid = _.uniqueId('sandbox');
        this.attributes = {};
        if (options.parse) attrs = this.parse(attrs, options) || {};
        if (defaults = _.result(this, 'defaults')) {
            attrs = _.defaults({}, attrs, defaults);
        }
        this.set(attrs, options);
        this.changed = {};
        this.configure.apply(this, options);
        this.initialize.apply(this, options);
    };

    var omitKeys = ["escape", "id", "idAttribute", "cid", "attributes", "changed", "validate", "validationError", "clone"];

    _.extend(Sandbox.prototype, _.omit(Backbone.Model.prototype, omitKeys), Backbone.Events, {
        //Space here to add extra functionality.

        configure: function (options) {
            options || (options = {});


            this.isChild = false;
            if (options.parent) { this.setParent(options.parent); }
            this._results = {};
            this._volunteers = {};

            this._modules = [];
            this._moduleLookup = {};
            this._started = false;

            this._mirrors = {};

            //Ajax defaults: Requires-
            // url - defaultBase to go to
            // page - Default aspx page to load
            // dataType - dataType to have
            this._ajaxDefaults = _.extend({
                url: "../PublicAjax/",
                page: "Ajax.aspx",
                dataType: "json",
                requestType: "POST"
            }, (options.ajaxDefaults || {}));
        },

        setParent:function(parent)
        {
            ///<summary>Pass a sandbox to accept as the parent of this sandbox.</summary>
            this.isChild = true;
            this.parent = parent;
        },

        removeParent:function()
        {
            ///<summary>Revert the sandbox to having no parent. Memory safe.</summary>
            this.isChild = false;
            this.parent = null;
        },

        mirror:function(attr)
        {
            ///<summary>If the sandbox is a child, register this attribute to be looked up on the parent when using get, and set on the parent when using set.</summary>
            var t = this;
            if (t.isChild) {                
                t._mirrors[attr] = true;
            }
        },
        unmirror:function(attr)
        {
            var t = this;
            if (t._mirrors[attr]) {
                delete t._mirrors[attr];
            }
        },

        get:function(attr)
        {
            ///<summary>A moderated get, returning the value from either itself, or it's parent if the attribute has been mirrored.</summary>
            if (this.isChild && this.parent) {
                if (this._mirrors[attr] == true) {
                    return this.parent.get(attr);
                }
            }
            return this.attributes[attr];
        },

        set:function(key, val, options)
        {
            ///<summary>A moderated set, passing through to the parent any mirrored values. Use mirror:false in options to prevent this behaviour and only set values on this sandbox.</summary>

            var oSet = Backbone.Model.prototype.set;

            options || (options = {});

            if (options.mirror === false || !(this.isChild && this.parent)) {
                oSet.apply(this, arguments);
            } else {
                // Handle both `"key", value` and `{key: value}` -style arguments.
                if (typeof key === 'object') {
                    attrs = key;
                    options = val;
                } else {
                    (attrs = {})[key] = val;
                }

                //Grab all attributes to be mirrored and pass them to the parent. 
                var mirrors = _.pick(attrs, _.keys(this._mirrors));
                //Set all other values on ourselves.
                var others = _.omit(attrs, _.keys(this._mirrors));

                oSet.call(this, others, options);
                this.parent.set(mirrors, options);                
            }


        },

        sync:function(attr)
        {
            ///<summary>Synchronize an attribute from the sandbox's parent to the sandbox. Creates the value in the child if it does not already exist.</summary>
            this.set(attr, this.parent.get(attr));
        },

        initialize: function () { },


        //This should be an alias for set with silent set to true.
        store: function (key, val, options) {
            ///<summary>Store a value, without firing any change events or saving in previous attributes. Use for objects that are guaranteed to be unchanged.</summary>


            var attr, attrs, current;
            if (key == null) return this;

            // Handle both `"key", value` and `{key: value}` -style arguments.
            if (typeof key === 'object') {
                attrs = key;
                options = val;
            } else {
                (attrs = {})[key] = val;
            }
            current = this.attributes;
            // For each `set` attribute, update or delete the current value.
            for (attr in attrs) {
                current[attr] = attrs[attr];
            }
        },

        //Validated trigger - 
        ask: function (id, name, params) {
            ///<summary>Intended to be a validated trigger.</summary>
            //if (ok) {
            this.trigger(name, params);
            //}
        },

        //Ask for the results of a value. Allows calling a function of another module and getting the result. 
        request: function (name, parameters, options) {
            ///<summary>Request a function to be performed by another module.</summary>
            if (!this.hasEvent("request:"+name))
            {
                if (this.isChild) { return this.parent.request(name, parameters, options); }
                else {
                    return;
                }
            }
            parameters || (parameters = {});
            options || (options = {});

            this.trigger("request:" + name, parameters);
            var result = this._results[name];
            var ret = result;
            if ((_.isObject(result) || _.isArray(result)) && options.clone) { ret = _.clone(result); }
            return ret;
        },


        
        approve: function (id, names) {
            ///<summary>Called by modules that volunteer values, to allow this module to know they are ready. Triggers initialization of any remaining modules.</summary>
            var t = this;
            _.defer(function () { _.each(t._modules, function (module) { module.updateRequirements(names); }); });
        },

        //Allow a module to volunteer to return values for a request. 
        volunteer: function (name, module, callback, options) {
            ///<summary>Volunteer a function to be called to return a requested value.</summary>

            var args = slice.call(arguments, 3);
            var volunteers = this._volunteers;
            var names = [];
            //Accept a list of names.
            if (!_.isArray(name)) {
                names.push(name);
            } else {
                names = name;
            }
            //Permit module to be omitted.
            if (_.isFunction(module) && !options) {
                var opts = _.clone(callback);
                callback = module;
                options = opts;
            }
            
            _.each(names, function (name) {
                volunteers[name] = function (params) {
                    var argums = slice.call(arguments, 0);
                    if (callback) {
                        if (_.isFunction(callback))
                        {
                            if (argums.length > 1) {
                                this._results[name] = callback.apply(this, argums);
                            }else{
                                this._results[name] = callback.call(this, params);
                            }
                        }
                        else if (_.isString(callback)) {
                            if (argums.length > 1) {
                                this._results[name] = module[callback].apply(module, argums);
                            } else {
                                this._results[name] = module[callback].call(module, params);
                            }
                        }
                    } else {
                        if (argums.length > 1) {
                            var newArgs = [];
                            newArgs.push(name);
                            newArgs.concat(argums);
                            this._results[name] = module._volunteer.apply(module, newArgs);
                        } else {
                            this._results[name] = module._volunteer.call(module, name, params);
                        }
                    }
                };
                this.off("request:" + name);
                this.on("request:" + name, volunteers[name]);
            }, this);
        },

        volunteerOff: function (name, options) {
            ///<summary>Remove a volunteer by a given name.</summary>

            this.off("request:" + name, volunteers[name]);
            volunteers[name] = null;
        },


        ajax: function (params, success, failure, context) {
            var url, page, dataType, requestType;

            var config = params.ajaxConfig;
            var requestConfig = params.requestConfig;
            var defaults = this._ajaxDefaults;
            if (config) {
                url = config.url || defaults.url;
                page = config.page || defaults.page;
                dataType = config.dataType || defaults.dataType;
                requestType = config.requestType || defaults.requestType;
            }

            var requestURL = url + page;
            requestURL += "?action=" + (requestConfig.action || 'noAction');
            requestURL += "&type=" + (requestConfig.type || 'default');

            var ctx = context || this;

            function ajaxGood(a, b, c) {
                success.call(ctx, a, b, c);
            }

            function ajaxBad(a, b, c) {
                failure.call(ctx, a, b, c);
            }

            $.ajax({
                url: requestURL,
                type: requestType,
                dataType: dataType,
                data: _.omit(params, ["ajaxConfig", "requestConfig"]),
                success: ajaxGood,
                error: ajaxBad
            });

        },

        
        domAllowed: function (id) {
            ///<summary>Not implemented. Determine whether or not the dom access should be allowed.</summary>
            return true;
        },

        //Currently not implemented. Allows control & restriction over dom access as all modules use this over basic $.

        //Suggestion: Register some modules (by ID) to have a certain aspect of the DOM be their root other than document.
        //            Example, the search settings module returns the equivalent of $("#searchSettingsModuleRoot").find(selector).
        //            This could be defined at the implementation of each module.
        //            
        dom$: function (id, selector) {
            return $(selector);
        },


        //Perform a certain function using different actions. If this is a microbox, call the parent's perform event and get the correct action performed. 
        perform: function (action) {
            var args = slice.call(arguments, 1);
            _.each(this._modules, function (module) { module.perform(action, args); });
        },

        //Returns true if a module is active and owned by this sandbox.
        moduleIsActive:function(module)
        {
            if(this._modules[this._moduleLookup[module.id]].isActive() === true) {
                return true;
            }
        },

        //Register a module to be started up
        register: function (module) {

            var mod = new module({ sandbox: this });
            var sbModule = new SandboxModule(mod);
            //Save where this is.
            this._moduleLookup[mod.id] = this._modules.push(sbModule) - 1;
        },


        start: function () {
            ///<summary>Start the sandbox, initializing all modules that can be initialized, in proper order. Can only be called once.</summary>
            if (!this._started) {
                _.each(this._modules, function (module) { module.start(); });
                this._started = true;
            }
        }

    });


    /*
    Register

        - Name:
        - Function:
        - Requirements:


    */









    //Module - A module of the app. A container for views & events


    //Results Filter - Works with a ResultsList to handle sifting and showing/hiding of content.
    var Module = App.Module = function (options) {
        if (this.config && this.config.setup && _.isFunction(this.config.setup)) {
            this.config.setup(this);
        }
        this.id = _.uniqueId("Module_");
        this._options = options;
    }

    //Options to directly apply to the module.
    var moduleOptions = ["sandbox", "microbox"];

    _.extend(Module.prototype, Backbone.Events, {

        //The actions this module can perform if active
        actions: {},

        //A list of what this module requires from the sandbox.
        requires: [],

        //A list of what this module will provide (volunteer) to the sandbox.
        provides: [],

        configure: function (options) {
            ///<summary>Called by SandboxModule.start - Configures this module with the neccesary stuff.</summary>
            
            

            var defaults;
            if (defaults = _.result(this, 'defaults')) {
                _.extend(this, defaults);
            }

            //Strip keywords from options & apply them to the module.
            _.each(moduleOptions, function (def) {
                if (options[def]) {
                    this[def] = options[def];
                }
            }, this);
            options = _.omit(options, moduleOptions);


            this.attributes = {};

            /*
            this.$el = $("<div></div>");
            this.registerDom(this.$parent);
            */

            this.active = true;

            this.initialize(options);
        },

        defaults: function () {
        },

        initialize: function (options) {

        },

        registerDom:function($parent, options)
        {
            ///<summary>Register the top level node on the DOM which contains this module.</summary>
            if (_.isString($parent)) {
                $parent = $($parent);
            }
            options || (options = {});

            
            this._$parent = $parent;
            this.$el.append(this._$parent);
            this._$detached = null;
            this.trigger("modeule:attached");            
        },

        remove: function () {
            this.stopListening();
        },


        set: function (attr, value) {
            this.attributes[attr] = value;
        },
        get: function (attr) {
            return this.attributes[attr];
        },

        _volunteer: function (name, params) {
            if (this.attributes[name] && _.contains(this.provides, name)) {
                return this.get[name];
            }
            return this.volunteer(name, params);
        },
        volunteer: function (name) {

        },

        $:function(selector)
        {
            if (this.$el) {
                return this.$el.find(selector);
            } else {
                return null;
            }
        },

        detach: function () {
            ///<summary>Detach this module from the DOM.</summary>
            if (this._$parent) {
                this._$detached = this.$el.detach();
            }
        },
        undetach: function () {
            ///<summary>Place this module back in the DOM at it's original location.</summary>
            if (this._$parent && this._$detached) {
                this.$el = this._$parent.append(this._$detached);
                this._$detached = null;
            }
        }
    });


    var ModuleView = App.ModuleView = function (options) {

    }


    App.Sandbox.extend = App.Module.extend = Backbone.Model.extend;


}).call(this);




TimeHelpers = {
    days: ["Sun", "Mon", "Tues", "Wed", "Thurs", "Fri", "Sat"],
    days_long: [{ abbrev: "Sun", full: "Sunday" },
               { abbrev: "Mon", full: "Monday" },
               { abbrev: "Tues", full: "Tuesday" },
               { abbrev: "Wed", full: "Wednesday" },
               { abbrev: "Thurs", full: "Thursday" },
               { abbrev: "Fri", full: "Friday" },
               { abbrev: "Sat", full: "Saturday" }],
    scheduleStringDayNames:["", "Mon", "Tues", "Wed", "Thurs", "Fri", "Sat", "Sun"]
}

