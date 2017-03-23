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


var mdns = require('mdns-spawn'),
    vorpal = require('vorpal')(),
    vorpalAutocompleteFs = require('vorpal-autocomplete-fs'),
    commands = require('sensorlab-commands'),
    Collector = require('sensorlab-collector'),
    fs = require('fs'),
    Q = require('q'),
    version = require('./package.json').version;

var observers,
    collectors,
    browser,
    helpers;


helpers = {};
helpers.services = {};
helpers.services.register = function(observers, service){
    var match, uid;

    if ( !!(match = /observer-(\d+)/.exec(service.service_name)) ) {
        uid = match[1];
        observers[uid] = { 'uid': uid, 'commands': commands(service.service_name+'.local', '5555', true) };
    }
};
helpers.services.deregister = function(observers, service){
    var match, uid;

    if ( !!(match = /observer-(\d+)/.exec(service.service_name)) ) {
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

helpers.format.error.unknownExperimentCollector = function(experiment_id, collectors){
    var collectorsList;

    collectorsList = Object.keys(collectors).sort();
    return vorpal.chalk.red('error: unknown experiment collector: '+experiment_id+'. list of known collectors: '
        + collectorsList.join(', '));
};

helpers.format.error.commandError = function(errorSummary){
  if(errorSummary.body){
      return vorpal.chalk.red(errorSummary.body);
  } else {
      return vorpal.chalk.red(errorSummary.error);
  }
};

helpers.format.uids = function (uids) {
    return uids.join(', ');
};

helpers.format.collectors = function(collectors){
    return collectors.join(', ');
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

helpers.format.observer = {};
helpers.format.observer.status = function(status){
    var output = vorpal.chalk.yellow('observer ' + status.node.id);
    output += ' :: node: ';
    if(status.node.hardware.id !== 'undefined'){
        output += vorpal.chalk.green(status.node.hardware.id);
    }else{
        output += vorpal.chalk.red('not configured');
    }
    output += ' :: experiment: ';

    if(status.node.experiment == undefined){
        output += vorpal.chalk.red('not configured');
    }else{
        switch (status.node.experiment.state){
            case 'ready':
                output += vorpal.chalk.blue(status.node.experiment.id);
                break;
            case 'running':
                output += vorpal.chalk.green(status.node.experiment.id);
                output += ' remaining: ' + helpers.format.property(status.node.experiment.remaining);
                break;
            case 'halted':
                output += vorpal.chalk.red(status.node.experiment.id);
                break;
            default:
                output += vorpal.chalk.grey(status.node.experiment.id);
                break;
        }
    }
    output += ' :: I/Os: ';
    if(status.io.address == 'undefined'){
        output += vorpal.chalk.red('not configured');
    } else {
        switch(status.io.state){
            case 'disconnected':
                output += ' '+ vorpal.chalk.red(status.io.address+':'+status.io.port + '(not connected)');
                break;
            case 'ready':
                output += ' ' + vorpal.chalk.yellow(status.io.address+':'+status.io.port + '(ready)');
                break;
            case 'connecting':
                output += ' ' + vorpal.chalk.blue(status.io.address+':'+status.io.port + '(connecting)');
                break;
            case 'connected':
                output += ' ' + vorpal.chalk.green(status.io.address+':'+status.io.port + '(connected)');
                break;
        }
    }
    return output;
};

helpers.format.node = {};
helpers.format.node.status = function(status){
    return  vorpal.chalk.yellow('observer ' + status.id)+
            ' (' + vorpal.chalk.green(status.hardware.id) + ') ' +
            'state: ' + helpers.format.state(status.hardware.state) +
            ' firmware: ' + helpers.format.property(status.hardware.firmware) +
            ' checksum: ' + helpers.format.property(status.hardware.checksum);
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

    format = vorpal.chalk.yellow('observer ' + uid);
    if(status.experiment){
          format += ' id: ' + helpers.format.experiment.behavior(status.experiment.id) +
          ' state: ' + helpers.format.state(status.experiment.state);
          if(status.experiment.state === 'running'){
            format += ' remaining: ' + helpers.format.property(status.experiment.remaining);
          }
          format += ' duration: ' + helpers.format.property(status.experiment.duration);
    }else{
        format += ' experiment: ' + helpers.format.state('undefined');
    }
    return format;
};

helpers.format.io = {};
helpers.format.io.status = function(uid, status){
    var format;
    format = vorpal.chalk.yellow('observer ' + uid)+
        ' address: ' + helpers.format.property(status.address) + ':' + helpers.format.property(status.port) +
        ' state: ' + helpers.format.state(status.state);
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

helpers.format.system = {};
helpers.format.system.status = function(uid, status){
    var format;

    format = vorpal.chalk.yellow('observer ' + uid) +
        ' (' + helpers.format.property('v'+status.version) + ') ::' +
        ' clock source: ' + helpers.format.property(status.synchronization.source) +
        ' clock offset: ' + helpers.format.property(status.synchronization.offset) +
        ' (standard deviation: ' + helpers.format.property(status.synchronization.offset_std) + ')';
    return format;
};

helpers.format.system.log = function(uid, log){
    var format;
    format = '';
    log.log.split('\n').forEach(function(line){
        if(/ERROR/.exec(line)){
            format += vorpal.chalk.red(line) +'\n';
        }else if(/WARNING/.exec(line)){
            format += vorpal.chalk.yellow(line) +'\n';
        }else if(/INFO/.exec(line)){
            format += vorpal.chalk.yellow(line) +'\n';
        }else if(/DEBUG/.exec(line)){
            format += vorpal.chalk.white(line) +'\n';
        }else{
            format += line +'\n';
        }
    });
    return format;
};

helpers.format.system.synchronization = function(uid, synchronization){
    var format;
    format = vorpal.chalk.yellow('observer ' + uid) +
        ' clock: ' + helpers.format.property(synchronization['date']) +
        ' clock source: ' + helpers.format.property(synchronization['sync_source']) +
        ' clock offset: ' + helpers.format.property(synchronization['offset']) +
        ' (standard deviation: ' + helpers.format.property(synchronization.offset_std) + ')';
    return format;
};

helpers.format.system.version = function(uid, version){
    var format;
    format = vorpal.chalk.yellow('observer ' + uid) +
        ' version: ' + helpers.format.property(version.version);
    return format;
};

helpers.output = {};

helpers.output.observer = {};
helpers.output.observer.status = function(uids, statuses){
    statuses.forEach(function(status){
        vorpal.log(helpers.format.observer.status(status));
    });
};
helpers.output.root = helpers.output.observer;

helpers.output.node = {};
helpers.output.node.status =
helpers.output.node.setup =
helpers.output.node.start =
helpers.output.node.stop =
helpers.output.node.reset = function(uids, statuses){
    statuses.forEach(function(status){
        vorpal.log(helpers.format.node.status(status));
    });
};

helpers.output.experiment = {};
helpers.output.experiment.status =
helpers.output.experiment.setup =
helpers.output.experiment.start =
helpers.output.experiment.stop =
helpers.output.experiment.reset = function(uids, statuses){
    statuses.forEach(function(status, index){
        vorpal.log(helpers.format.experiment.status(uids[index], status));
    });
};

helpers.output.io = {};
helpers.output.io.status =
helpers.output.io.setup =
helpers.output.io.start =
helpers.output.io.stop =
    function(uids, statuses){
    statuses.forEach(function(status, index){
        vorpal.log(helpers.format.io.status(uids[index], status));
    });
};

helpers.output.location = {};
helpers.output.location.status = function(uids, statuses){
    statuses.forEach(function(status, index){
        vorpal.log(helpers.format.location.status(uids[index], status));
    });
};

helpers.output.system = {};
helpers.output.system.status = function(uids, statuses){
    statuses.forEach(function(status, index){
        vorpal.log(helpers.format.system.status(uids[index], status));
    });
};

helpers.output.system.log = function(uids, logs){
    logs.forEach(function(log, index){
        vorpal.log(helpers.format.system.log(uids[index], log));
    });
};

helpers.output.system.version = function(uids, versions){
    versions.forEach(function(version, index){
        vorpal.log(helpers.format.system.version(uids[index], version));
    });
};


helpers.output.system.synchronization = function(uids, synchronizations){
    synchronizations.forEach(function(synchronization, index){
        vorpal.log(helpers.format.system.synchronization(uids[index], synchronization));
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
        .then(helpers.output[target][command].bind(null, uids), helpers.output.error.commandError)
        .then(callback);
};

helpers.collectors = {};
helpers.collectors.create = function(broker_address, broker_port, experiment_id, type,callback){
    
    collectors[experiment_id] = new Collector(broker_address, broker_port, experiment_id, type);
    collectors[experiment_id].start();
    callback();
};
helpers.collectors.destroy = function(experiment_id, callback){
    if(collectors[experiment_id]){
        collectors[experiment_id].end();
        delete collectors[experiment_id];
        callback();
    }else{
        vorpal.log(helpers.format.error.unknownExperimentCollector(experiment_id, collectors));
        callback();
    }
};

helpers.collectors.autocomplete = function(){
    return Object.keys(collectors).map(String);
};

observers = {};
collectors = {};

browser = new mdns();
browser.addEvent('serviceUp', helpers.services.register.bind(null, observers));
browser.addEvent('serviceDown', helpers.services.deregister.bind(null, observers));
browser.start();

/* store history */
vorpal.history('sensorlab-cli');

/* usage memo */
vorpal
    .command('memo', 'workflow reminder', {})
    .alias('workflow')
    .action(function(args, callback){
       vorpal.log(
           vorpal.chalk.yellow(
               vorpal.chalk.bold(
           " # 0. Prerequisites                                                        \n"
                )
           )+
           " ------------------------------------------------------------------------- \n"+
           " - query the observers state:                                              \n"+
           "   > "+vorpal.chalk.cyan("observer status <list of observers>")+"                                  \n"+
           "                                                                           \n"+
           " - if an experiment is already running, contact the owner.                 \n"+
           "          DO NOT STOP a RUNNING EXPERIMENT UNLESS IT'S YOURS!              \n"+
           "                                                                           \n"+
           " - stop any existing experiment and reset the experiment handler:          \n"+
           "   > "+vorpal.chalk.cyan("experiment stop <list of observers>")+"                                   \n"+
           "   > "+vorpal.chalk.cyan("experiment reset <list of observers>")+"                                  \n"+
           "                                                                           \n"+
           " - query the I/Os state:                                                   \n"+
           "   > "+vorpal.chalk.cyan("io status <list of observers>")+"                                         \n"+
           "                                                                           \n"+
           " - if the MQTT broker address and port are not defined, provide them:      \n"+
           "   > "+vorpal.chalk.cyan("io setup <broker address> <broker port> <list of observers>")+"           \n"+
           "                                                                           \n"+
           " - query the I/Os state:                                                   \n"+
           "   > "+vorpal.chalk.cyan("io status <list of observers>")+"                                         \n"+
           "                                                                           \n"+
           " - if the I/O handler is connected jump to section "+vorpal.chalk.yellow("#1")+"                       \n"+
           " - otherwise initiate the connection:                                      \n"+
           "   > "+vorpal.chalk.cyan("io start <list of observers>")+"                                          \n"+
           "                                                                           \n"+
           " - verify that the change is in effect:                                    \n"+
           "   > "+vorpal.chalk.cyan("io status <list of observers>")+"                                         \n"+
           "                                                                           \n"+
           vorpal.chalk.yellow(
               vorpal.chalk.bold(
           " # 1. interfacing the observer with the device                             \n"
               )
           )+
           " ------------------------------------------------------------------------- \n"+
           " - query the current device interface:                                     \n"+
           "   > "+vorpal.chalk.cyan("node status <list of observers>")+"              \n"+
           "                                                                           \n"+
           " - if the interface matches the current device, jump to section "+vorpal.chalk.yellow("#2")+"          \n"+
           " - otherwise upload the interface:                                         \n"+
           "   > "+vorpal.chalk.cyan("node setup <profile.tar.gz> <list of observers>")+"                       \n"+
           "                                                                           \n"+
           " - verify that the change is in effect:                                    \n"+
           "   > "+vorpal.chalk.cyan("node status <list of observers>")+"              \n"+
           "                                                                           \n"+
           vorpal.chalk.yellow(
               vorpal.chalk.bold(" # 2. upload the experiment                          \n"
               )
           )+
           " ------------------------------------------------------------------------- \n"+
           " - upload the experiment profile:                                          \n"+
           "   > "+vorpal.chalk.cyan("experiment setup <experiment_id> <profile.tar.gz> <list of observers>")+" \n"+
           "                                                                           \n"+
           " - query the experiment handler status:                                    \n"+
           "   > "+vorpal.chalk.cyan("experiment status <list of observers>")+"        \n"+
           "                                                                           \n"+
           vorpal.chalk.yellow(
               vorpal.chalk.bold(" # 3. setup an experiment collector (optional)       \n"
               )
           )+
           " ------------------------------------------------------------------------- \n"+
           " - setup a collector for the log trace you're interested in (json,pcap):   \n"+
           "   > "+vorpal.chalk.cyan("collector setup <address> <port> <experiment_id> <type: json or pcap>")+"                  \n"+
           "                                                                           \n"+
           vorpal.chalk.yellow(
               vorpal.chalk.bold(" # 4. start the experiment                           \n"
               )
           )+
           " ------------------------------------------------------------------------- \n"+
           " - start the experiment scheduler:                                         \n"+
           "   > "+vorpal.chalk.cyan("experiment start <list of observers>")+"         \n"+
           "                                                                           \n"+
           " - query the experiment handler status                                     \n"+
           "   > "+vorpal.chalk.cyan("experiment status <list of observers>")+"        \n"+
           "                                                                           \n"+
           vorpal.chalk.yellow(
               vorpal.chalk.bold(" # 5. clean-up                                       \n"
               )
           )+
           " ------------------------------------------------------------------------- \n"+
           " - at the end of the experiment, discard collectors:                       \n"+
           "   > "+vorpal.chalk.cyan("collector stop <experiment_id>")+"               \n"+
           "                                                                           \n"+
           " ------------------------------------------------------------------------- \n"+

           vorpal.chalk.yellow(
               vorpal.chalk.bold(" # 6. submitting an issue                            \n"
               )
           )+
           "                                                                           \n"+
           " ------------------------------------------------------------------------- \n"+
           " - collect the version numbers of the observers and your CLI client:       \n"+
           "   > "+vorpal.chalk.cyan("system version <list of observers>")+"           \n"+
           "   > "+vorpal.chalk.cyan("version")+"                                      \n"+
           "                                                                           \n"+
           " - query the observer system logs:                                         \n"+
           "   > "+vorpal.chalk.cyan("system log <date> <list of observers>")+"        \n"+
           "                                                                           \n"+
           " - if system logs reports any connectivity issue related                   \n"+
           "                 report to the network administrator                       \n"+
           "                                                                           \n"+
           " - if system logs reports a runtime exception, report with a github issue  \n"+
           "   "+vorpal.chalk.cyan("TRIM ANY NON-LOCAL ADDRESS FROM LOGS BEFORE REPORTING")+"            \n"+
           "                                                                           \n"+
           " - else send your description of the issue along with logs to your local   \n"+
       "                                    Sensorlab admin                            \n"+
           " ------------------------------------------------------------------------- \n"+
           vorpal.chalk.yellow(
               vorpal.chalk.bold(" # 42. friendly reminder                             \n"
               )
           )+
           " ------------------------------------------------------------------------- \n"+
           " - this is a PoC, not some kind of Apollo-grade software                   \n"+
           " - even Apollo-grade mission can go wrong, Apollo 13 anyone?               \n"+
           " - Nobody has voodoo powers, provide detailed analysis of your             \n"+
           "   issues in a github issue.                                               \n"+
           " - Refrain from sending mails containing exclamation marks, urgent sign    \n"+
           "   superlative, etc. It's offensive.                                       \n"+
           "                                                                           \n"+
           " ------------------------------------------------------------------------- \n"

       );
        callback();
    });

vorpal
    .command('observers', 'list of observers', {})
    .alias('list')
    .action(function (args, callback) {
        var uids;
        uids = Object.keys(observers).sort();
        vorpal.log(helpers.format.uids(uids));
        callback();
    });

vorpal
    .command('collectors', 'list of collectors', {})
    .alias('clist')
    .action(function (args, callback) {
        var cols;
        cols = Object.keys(collectors).sort();
        vorpal.log(helpers.format.collectors(cols));
        callback();
    });

vorpal
    .command('observer status [observers...]', 'require status of supplied list of observers', {})
    .alias('ostatus')
    .autocomplete({data:helpers.observers.autocomplete})
    .action(helpers.vorpal.action.bind(this,'root','status',[]));

/* node commands */
vorpal
    .command('node status [observers...]', 'require node status of supplied list of observers', {})
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
        try {
            helpers.vorpal.action.bind(this,'node','load',[args.firmware_id, fs.createReadStream(args.firmware)])(args, callback);
        } catch (exception) {
            vorpal.log(vorpal.chalk.red('cannot read firmware ['+args.firmware+']\n. Error: '+exception));
            callback();
        }
    });
vorpal
    .command('node setup <profile> [observers...]', 'configure node modules of supplied list of observers', {})
    .alias('nsetup')
    .autocomplete(vorpalAutocompleteFs())
    .action(function (args, callback) {
        try {
            helpers.vorpal.action.bind(this,'node','setup',[fs.createReadStream(args.profile)])(args, callback);
        } catch (exception) {
            vorpal.log(vorpal.chalk.red('cannot read profile ['+args.profile+']\n. Error: '+exception));
            callback();
        }
    });

vorpal
    .command('node reset [observers...]', 'reset node modules of supplied list of observers', {})
    .alias('nreset')
    .autocomplete({data:helpers.observers.autocomplete})
    .action(helpers.vorpal.action.bind(this,'node','reset',[]));

/* experiment commands */
vorpal
    .command('experiment status [observers...]', 'require experiment status of supplied list of observers', {})
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
        try{
            helpers.vorpal.action.bind(this,'experiment','setup',[args.experiment_id, fs.createReadStream(args.behavior)])(args, callback);
        } catch (exception) {
            vorpal.log(vorpal.chalk.red('cannot read behavior ['+args.behavior+']\n. Error: '+exception));
            callback();
        }
    });

/* I/O commands */
vorpal
    .command('io status [observers...]', 'require io status of supplied list of observers', {})
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
    .command('io setup <address> <port> [observers...]', 'configure io modules of supplied list of observers', {})
    .alias('iosetup')
    .autocomplete({data:helpers.observers.autocomplete})
    .action(function (args, callback) {
        helpers.vorpal.action.bind(this,'io','setup',[args.address, args.port])(args, callback);
    });
/* Collector commands */
vorpal
    .command('collector setup <address> <port> <experiment_id> <type>', 'setup log collection', {})
    .alias('csetup')
    .help(function(args){})
    .action(function (args, callback){
        helpers.collectors.create(args.address, args.port, args.experiment_id,  args.type, callback);
    });
vorpal
    .command('collector stop <experiment_id>', 'stop log collection', {})
    .alias('cstop')
    .autocomplete({data:helpers.collectors.autocomplete})
    .action(function (args, callback){
        helpers.collectors.destroy(args.experiment_id, callback);
    });

/* location commands */
vorpal
    .command('location status [observers...]', 'require location status of supplied list of observers', {})
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
    .command('system status [observers...]', 'require system status, i.e. version and sync status of supplied list of observers', {})
    .alias('sstatus')
    .autocomplete({data:helpers.observers.autocomplete})
    .action(helpers.vorpal.action.bind(this,'system','status',[]));
vorpal
    .command(' system version [observers...]', 'require system version of supplied list of observers', {})
    .alias('sversion')
    .autocomplete({data:helpers.observers.autocomplete})
    .action(helpers.vorpal.action.bind(this,'system','version',[]));
vorpal
    .command('system synchronization [observers...]', 'require synchronization status of supplied list of observers', {})
    .alias('ssync')
    .autocomplete({data:helpers.observers.autocomplete})
    .action(helpers.vorpal.action.bind(this,'system','synchronization',[]));
vorpal
    .command('system log <since> [observers...]', 'require logs of supplied list of observers', {})
    .alias('slog')
    .autocomplete({data:helpers.observers.autocomplete})
    .action(function (args, callback) {
        helpers.vorpal.action.bind(this,'system','log',[args.since])(args, callback);
    });
vorpal
    .command('version', 'returns sensorlab-cli version',{})
    .action(function (args, callback) {
        vorpal.log('version: ' + version);
        callback();
    });


vorpal
    .delimiter(vorpal.chalk.green('>'))
    .show();
