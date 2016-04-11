/**
 *
 * Sensorlab2 Command Line Interface.
 * `author`	:	Quentin Lampin <quentin.lampin@orange.com>
 * `license`	:	MPL
 * `date`		:	2016/04/11
 * Copyright 2016 Orange
 *
 * Interactive command line interface to pilot SensorLab observers
 */


var bonjour = require('bonjour')(),
    vorpal = require('vorpal')(),
    vorpalAutocompleteFs = require('vorpal-autocomplete-fs'),
    commands = require('sensorlab-commands'),
    fs = require('fs'),
    Q = require('q');

var observers,
    browser,
    helpers;


helpers = {};
helpers.services = {};
helpers.services.register = function(observers, service){
    var match, uid;

    if ( !!(match = /observer-(\d+)/.exec(service.name)) ) {
        uid = match[1];
        observers[uid] = { 'uid': uid, 'commands': commands(service.host, service.port, true) };
    }
};
helpers.services.deregister = function(observers, service){
    var match, uid;

    if ( !!(match = /observer-(\d+)/.exec(service.name)) ) {
        uid = match[1];
        delete observers[uid];
    }
};

helpers.observers = {};
helpers.observers.autocomplete = function(){
    return Object.keys(observers).map(String);
};

helpers.comprehension = {};
helpers.comprehension.included = function(lowerBound, upperBound, value){
    return (Number(value) >= Number(lowerBound) && Number(value) <= Number(upperBound));
};


helpers.format = {};
helpers.format.error = {};
helpers.format.error.comprehension = function(passed){
    return vorpal.chalk.red('error: comprehension must be of form <number>..<number>, received ' + passed);
};
helpers.format.error.observerNotFound = function(passed){
    return vorpal.chalk.red('error: unknown observer id: ' + passed);
};
helpers.format.error.observerNotSupplied = function(){
    return vorpal.chalk.red('error: no observer ID supplied');
};

helpers.format.error.commandError = function(errorSummary){
  return vorpal.chalk.red('error: ' + errorSummary.error + ' with response: ' + errorSummary.response + ' and body: '+ errorSummary.body);
};

helpers.format.uids = function (uids) {
    return uids.join(', ');
};

helpers.format.state = function(state){
    switch (state) {
        case 'ready':
        case 'connected':
        case 'online':
            return vorpal.chalk.blue(state);
            break;
        case 'running':
            return vorpal.chalk.green(state);
            break;
        case 'halted':
            return vorpal.chalk.red(state);
            break;
        default:
            return vorpal.chalk.grey(state);
            break;
    }
};

helpers.format.property = function(property){
    switch(property){
        case 'none':
        case 'undefined':
            return vorpal.chalk.grey(property);
            break;
        default:
            return vorpal.chalk.blue(property);
            break;
    }
};

helpers.format.node = {};
helpers.format.node.status = function(status){
    return  vorpal.chalk.yellow('observer ' + status.id)+
            ' device: ' + helpers.format.state(status.state) +
            ' serial: ' + vorpal.chalk.blue(status.serial.module);
};

helpers.format.experiment = {};
helpers.format.experiment.behavior =
helpers.format.experiment.remaining =
helpers.format.experiment.duration = function(behavior){
    switch(behavior){
        case 'none':
        case 'undefined':
            return vorpal.chalk.grey(behavior);
            break;
        default:
            return vorpal.chalk.blue(behavior);
            break;
    }
};
helpers.format.experiment.status = function(uid, status){
    var format;
    format = vorpal.chalk.yellow('observer ' + uid)+
        ' behavior: ' + helpers.format.experiment.behavior (status.id) +
        ' state: ' + helpers.format.state(status.state) +
        ' remaining/duration: ' + helpers.format.property(status.scheduler.remaining) +'/'
                                + helpers.format.property(status.scheduler.duration);
    return format;
};

helpers.format.io = {};
helpers.format.io.status = function(uid, status){
    var format;
    format = vorpal.chalk.yellow('observer ' + uid)+
        ' state: ' + helpers.format.state(status.state) +
        ' broker: ' + helpers.format.property(status.broker_address) + ':' + helpers.format.property(status.broker_port) +
        ' source: ' + helpers.format.property(status.source);
    return format;
};

helpers.format.location = {};
helpers.format.location.uncertainty = function(value){
    if(value < 2){
        return vorpal.chalk.green(value);
    }else if(value < 10){
        return vorpal.chalk.yellow(value);
    }else if(value < 50){
        return vorpal.chalk.red(value);
    }else{
        return vorpal.chalk.black(value);
    }
};
helpers.format.location.status = function(uid, status){
    var format;

    format = vorpal.chalk.yellow('observer ' + uid) +
        ' state: ' + helpers.format.state(status.state) +
        ' position: (' + helpers.format.property(status.latitude) + ',' + helpers.format.property(status.longitude) + ')[' + helpers.format.property(status.altitude) + ']' +
        ' uncertainty: (' + helpers.format.location.uncertainty(status.error_estimate_latitude) + ', ' +
                            helpers.format.location.uncertainty(status.error_estimate_longitude) + ', ' +
                            helpers.format.location.uncertainty(status.error_estimate_altitude) + ')';
    return format;
};

helpers.output = {};
helpers.output.node = {};
helpers.output.node.statuses = function(uids, statuses){
    statuses.forEach(function(status){
        vorpal.log(helpers.format.node.status(status));
    });
};

helpers.output.experiment = {};
helpers.output.experiment.statuses = function(uids, statuses){
    statuses.forEach(function(status, index){
        vorpal.log(helpers.format.experiment.status(uids[index], status));
    });
};

helpers.output.io = {};
helpers.output.io.statuses = function(uids, statuses){
    statuses.forEach(function(status, index){
        vorpal.log(helpers.format.io.status(uids[index], status));
    });
};

helpers.output.location = {};
helpers.output.location.statuses = function(uids, statuses){
    statuses.forEach(function(status, index){
        vorpal.log(helpers.format.location.status(uids[index], status));
    });
};


helpers.output.error = {};
helpers.output.error.commandError = function(errorSummary){
    vorpal.log(helpers.format.error.commandError(errorSummary));
};


helpers.vorpal = {};
helpers.vorpal.action = function(target, command, params, args, callback){
    var promises,
        uids,
        match;

    promises = [];
    uids = [];
    if(!!args.observers && typeof(args.observers[0]) == 'string' && args.observers[0] === 'all'){
        uids = Object.keys(observers);
    }else{
        if(!args.observers){
            vorpal.log(helpers.format.error.observerNotSupplied());
            callback();
            return;
        }
        args.observers.forEach(function(uid){
            if( typeof(uid) == 'string' && uid.includes('..') ){
                if ( !!(match = /(\d+)\.\.(\d+)/.exec(uid)) ) {
                    Object.keys(observers)
                        .filter(helpers.comprehension.included.bind(null, match[1], match[2]))
                        .reduce(function(_prev, uid){
                            uids.push(uid);
                        }, 0);
                } else {
                    vorpal.log(helpers.format.error.comprehension(uid));
                    callback();
                }
            } else {
                if( uid in observers ){
                    uids.push(uid);
                } else {
                    vorpal.log(helpers.format.error.observerNotFound(uid));
                    callback();
                }
            }
        });
    }
    uids.forEach(function(uid){
        promises.push( observers[uid].commands[target][command].apply(this, params) );
    });
    Q.all(promises)
        .then(helpers.output[target].statuses.bind(null, uids), helpers.output.error.commandError)
        .then(callback);
};


observers = {};

browser = bonjour.find({type: 'http', protocol: 'tcp', subtypes: ['observer', 'rest']})
    .on('up', helpers.services.register.bind(null, observers))
    .on('down', helpers.services.deregister.bind(null, observers));


vorpal
    .command('observers', 'list of observers', {})
    .alias('list')
    .action(function (args, callback) {
        var uids;

        uids = Object.keys(observers).sort();
        vorpal.log(helpers.format.uids(uids));
        callback();
    });

// vorpal
//     .command('observer status [observers...]', 'require statuses of supplied list of observers', {})
//     .alias('ostatus')
//     .autocomplete({data:helpers.observers.autocomplete})
//     .action(helpers.vorpal.action.bind(this,'root','status',[]));

/* node commands */
vorpal
    .command('node status [observers...]', 'require node statuses of supplied list of observers', {})
    .alias('nstatus')
    .autocomplete({data:helpers.observers.autocomplete})
    .action(helpers.vorpal.action.bind(this,'node','status',[]));
vorpal
    .command('node init [observers...]', 'init devices of supplied list of observers', {})
    .alias('ninit')
    .autocomplete({data:helpers.observers.autocomplete})
    .action(helpers.vorpal.action.bind(this,'node','init',[]));
vorpal
    .command('node start [observers...]', 'start devices of supplied list of observers', {})
    .alias('nstart')
    .autocomplete({data:helpers.observers.autocomplete})
    .action(helpers.vorpal.action.bind(this,'node','start',[]));
vorpal
    .command('node stop [observers...]', 'stop devices of supplied list of observers', {})
    .alias('nstop')
    .autocomplete({data:helpers.observers.autocomplete})
    .action(helpers.vorpal.action.bind(this,'node','stop',[]));
vorpal
    .command('node load <firmware_id> <firmware> [observers...]', 'load firmware to devices of supplied list of observers', {})
    .alias('nload')
    .autocomplete(vorpalAutocompleteFs())
    .action(function (args, callback) {
        helpers.vorpal.action.bind(this,'node','load',[args.firmware_id, fs.createReadStream(args.firmware)])(args, callback);
    });
vorpal
    .command('node setup <profile> [observers...]', 'configure node modules of supplied list of observers', {})
    .alias('nsetup')
    .autocomplete(vorpalAutocompleteFs())
    .action(function (args, callback) {
            helpers.vorpal.action.bind(this,'node','setup',[fs.createReadStream(args.profile)])(args, callback);
    });

/* experiment commands */
vorpal
    .command('experiment status [observers...]', 'require experiment statuses of supplied list of observers', {})
    .alias('estatus')
    .autocomplete({data:helpers.observers.autocomplete})
    .action(helpers.vorpal.action.bind(this,'experiment','status',[]));
vorpal
    .command('experiment reset [observers...]', 'reset experiment of supplied list of observers', {})
    .alias('ereset')
    .autocomplete({data:helpers.observers.autocomplete})
    .action(helpers.vorpal.action.bind(this,'experiment','reset',[]));
vorpal
    .command('experiment start [observers...]', 'start experiments of supplied list of observers', {})
    .alias('estart')
    .autocomplete({data:helpers.observers.autocomplete})
    .action(helpers.vorpal.action.bind(this,'experiment','start',[]));
vorpal
    .command('experiment stop [observers...]', 'stop experiment of supplied list of observers', {})
    .alias('estop')
    .autocomplete({data:helpers.observers.autocomplete})
    .action(helpers.vorpal.action.bind(this,'experiment','stop',[]));
vorpal
    .command('experiment setup <experiment_id> <behavior> [observers...]', 'configure experiment modules of supplied list of observers', {})
    .alias('esetup')
    .autocomplete(vorpalAutocompleteFs())
    .action(function (args, callback) {
        helpers.vorpal.action.bind(this,'experiment','setup',[args.experiment_id, fs.createReadStream(args.behavior)])(args, callback);
    });

/* I/O commands */
vorpal
    .command('io status [observers...]', 'require io statuses of supplied list of observers', {})
    .alias('iostatus')
    .autocomplete({data:helpers.observers.autocomplete})
    .action(helpers.vorpal.action.bind(this,'io','status',[]));
vorpal
    .command('io start [observers...]', 'start experiments of supplied list of observers', {})
    .alias('iostart')
    .autocomplete({data:helpers.observers.autocomplete})
    .action(helpers.vorpal.action.bind(this,'io','start',[]));
vorpal
    .command('io stop [observers...]', 'stop experiment of supplied list of observers', {})
    .alias('iostop')
    .autocomplete({data:helpers.observers.autocomplete})
    .action(helpers.vorpal.action.bind(this,'io','stop',[]));
vorpal
    .command('io setup <source> <address> <port> <keepalive_period> [observers...]', 'configure io modules of supplied list of observers', {})
    .alias('iosetup')
    .autocomplete({data:helpers.observers.autocomplete})
    .action(function (args, callback) {
        helpers.vorpal.action.bind(this,'io','setup',[args.source, args.address, args.port, args.keepalive_period])(args, callback);
    });

/* location commands */
vorpal
    .command('location status [observers...]', 'require location statuses of supplied list of observers', {})
    .alias('lstatus')
    .autocomplete({data:helpers.observers.autocomplete})
    .action(helpers.vorpal.action.bind(this,'location','status',[]));
vorpal
    .command('location start [observers...]', 'start location module of supplied list of observers', {})
    .alias('lstart')
    .autocomplete({data:helpers.observers.autocomplete})
    .action(helpers.vorpal.action.bind(this,'location','start',[]));
vorpal
    .command('location stop [observers...]', 'stop experiment of supplied list of observers', {})
    .alias('lstop')
    .autocomplete({data:helpers.observers.autocomplete})
    .action(helpers.vorpal.action.bind(this,'location','stop',[]));
vorpal
    .command('location setup <latitude> <longitude> [observers...]', 'configure io modules of supplied list of observers', {})
    .alias('lsetup')
    .autocomplete({data:helpers.observers.autocomplete})
    .action(function (args, callback) {
        helpers.vorpal.action.bind(this,'location','setup',[args.latitude, args.longitude])(args, callback);
    });

vorpal
    .delimiter(vorpal.chalk.green('>'))
    .show();