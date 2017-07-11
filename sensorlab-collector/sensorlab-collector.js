/**
 *
 * Sensorlab2 MQTT experiment logs collection module.
 * `author`	:	Quentin Lampin <quentin.lampin@orange.com>
 * `license`	:	MPL
 * `date`		:	2016/06/15
 * Copyright 2016 Orange
 *
 * This module gathers logs pertaining to a Sensorlab experiment.
 * Logs are retained in a chronologically sorted buffer
 *
 */

require('events').EventEmitter.prototype._maxListeners = 100;


const DEFAULT_RETENTION = 5000; // 5s

var log = require('debug')('sensorlab-collector'),
    mqtt = require('mqtt-q'),
    Q = require('q'),
    fs = require('fs'),
    os = require('os'),
    sanitize = require('sanitize-filename'),
    binary = require('binary');


/**
 *
 * @param event
 * @param date
 * @constructor
 */
function Record(event, date){
    this.event = event;
    this.timeout = date;
}
Record.prototype.postpone = function(date){
    this.timeout = date;
};
Record.prototype.timestamp = function() {
    return this.event.timestamp;
};

/**
 *
 * @param {String} address - broker address
 * @param {String|Number} port - port on which the MQTT server listens to
 * @param {String} experiment - ID of the experiment, i.e. name of the sub-topic in which the JSON feeds from observers is
 *                      made available.
 * @param {String} type - type of the log to collect (pcap or json)
 * @param {stream.Writable} outputStream - output stream
 * @param {Number} retention - retention time in the buffer (milliseconds)
 * @constructor
 */
function Collector(address, port, experiment, type, outputStream, retention){
    this.address = address;
    this.port = port;
    this.experiment = experiment;
    this.type = type;
    this.retention = retention? retention: DEFAULT_RETENTION;
    this.buffer = [];
    this.mqttClient = new mqtt.Client(os.hostname+':'+experiment+':'+type, address, port, {clean:false});
    this.outputStream = outputStream ? outputStream : fs.createWriteStream('experiment-' + sanitize(experiment)+'.'+type);
    this.outputTimer = undefined;
}

Collector.prototype.submitPCAP = function(event){
    var now,
        fields,
        timestamp,
        record,
        rIndex,
        delay,
        i;

    // register current date
    now = Date.now();

    /* retrieve timestamp from the PCAP record header */
    fields = binary.parse(event)
              .word32lu('timeS')
              .word32lu('timeUs')
              .word32lu('inclLength')
              .word32lu('origLength')
              .vars;

    timestamp = fields['timeS'] + Math.pow(10,-6) * fields['timeUs']

    // create a new record
    record = new Record({timestamp: timestamp, pcap: event}, now + this.retention);
    log('record input: '+ JSON.stringify(record.event));

    this.buffer.push(record);
    // decreasing order sort: the last element is the oldest
    this.buffer.sort(function(record1, record2){return record2.timestamp() - record1.timestamp()});
    // postpone output of records more recent than this:
    //   find the index of the new record
    rIndex = this.buffer.indexOf(record);
    //   iterate records in decreasing timestamp order
    for(i=0; i<rIndex; i++){
        // compute the delay between the new record timestamp and records to postpone
        delay = (this.buffer[i].timestamp() - record.timestamp());
        this.buffer[i].postpone(now + this.retention + delay);
    }
    // if the submitted record is the oldest
    if(rIndex === this.buffer.length-1){
        // clear the output timer
        if(this.outputTimer){ clearTimeout(this.outputTimer);}
        this.outputTimer = setTimeout(this.outputPCAP.bind(this), record.timeout - now);
    }
};

Collector.prototype.submitJSON = function(event){
    var now,
        record,
        rIndex,
        delay,
        i;

    // register current date
    now = Date.now();
    // create a new record
    record = new Record(event, now + this.retention);
    log('record input: '+ JSON.stringify(record.event));

    this.buffer.push(record);
    // decreasing order sort: the last element is the oldest
    this.buffer.sort(function(record1, record2){return record2.timestamp() - record1.timestamp()});
    // postpone output of records more recent than this:
    //   find the index of the new record
    rIndex = this.buffer.indexOf(record);
    //   iterate records in decreasing timestamp order
    for(i=0; i<rIndex; i++){
        // compute the delay between the new record timestamp and records to postpone
        delay = (this.buffer[i].timestamp() - record.timestamp());
        this.buffer[i].postpone(now + this.retention + delay);
    }
    // if the submitted record is the oldest
    if(rIndex === this.buffer.length-1){
        // clear the output timer
        if(this.outputTimer){ clearTimeout(this.outputTimer);}
        this.outputTimer = setTimeout(this.outputJSON.bind(this), record.timeout - now);
    }
};

Collector.prototype.outputPCAP = function(){
    var record,
        now;

    // register current date
    now = Date.now();
    // output oldest record
    record = this.buffer.pop();
    log('record output: '+ JSON.stringify(record.event));
    this.outputStream.write(record.event.pcap);
    // setup next output unless there isn't a record to output
    if(this.buffer.length){
        this.outputTimer = setTimeout(this.outputPCAP.bind(this), this.buffer[this.buffer.length-1].timeout - now);
    }else{
        this.outputTimer = undefined;
    }
};


Collector.prototype.outputJSON = function(){
    var record,
        now;

    // register current date
    now = Date.now();
    // output oldest record
    record = this.buffer.pop();
    log('record output: '+ JSON.stringify(record.event));
    this.outputStream.write(JSON.stringify(record.event)+'\n');
    // setup next output unless there isn't a record to output
    if(this.buffer.length){
        this.outputTimer = setTimeout(this.outputJSON.bind(this), this.buffer[this.buffer.length-1].timeout - now);
    }else{
        this.outputTimer = undefined;
    }
};

Collector.prototype.onMessage = function (topic, message) {
    log('collector message received in topic ' + topic + ': ' + message);
    try{
        switch(this.type){
            case 'pcap':
                this.submitPCAP(message);
                break;
            default:
                this.submitJSON(JSON.parse(message));
                break;
        }
    }catch (error){
        log('error: ', error, ' occurred while parsing message: ', message);
    }

};

/**
 * start collection
 */
Collector.prototype.start = function(){
    var topic,
        qos,
        that,
        pcapHeader;
    switch (this.type){
        case 'pcap':
            topic = 'sensorlab/experiment/'+this.experiment+'/output/binary/#';
            pcapHeader = new Buffer([
              0xD4, 0xC3, 0xB2, 0xA1,
              0x02, 0x00, 0x04, 0x00,
              0x00, 0x00, 0x00, 0x00,
              0x00, 0x00, 0x00, 0x00,
              0xFF, 0xFF, 0x00, 0x00,
              0x93, 0x00, 0x00, 0x00]);
            this.outputStream.write(pcapHeader);
            break;
        default:
            topic = 'sensorlab/experiment/'+this.experiment+'/output/json/#';
            break;
    }
    qos = mqtt.qos.GUARANTEED_UNIQUE_DELIVERY;
    that = this;

    this.mqttClient.connect()
        .then( function(mqttClient) { return mqttClient.subscribe(topic, qos) })
        .then( function(mqttClient) { return mqttClient.on(mqtt.event.MESSAGE, that.onMessage.bind(that)) })
        .catch(function(error){
            log('error: ', error);
            throw error;
        })
        .done();
};

/**
 * end collection
 */
Collector.prototype.end = function(){
    this.mqttClient.end()
        .catch(function(error){
            log('error: ', error);
            throw error;
        })
        .done();
};

module.exports = Collector;
