# sensorlab-nexus

SensorLab2 commands module


## Brief

This node module builds a set of commands to control a SensorLab observer given its REST API port and host.

## Installation

sensorlab-commands is available via NPM:
 
```bash
    npm install sensorlab-commands --save
```

## Usage

### Using callbacks

```javascript
    var commands;
    
    commands = require('sensorlab-commands')('observer-X.local', 5555, false);
    function onSuccess(status){
        console.log('status: ', status);
    }
    function onError(error, response, body){
        console.log('error: ', error, ' response: ', response, ' body: ', body);
    }
    commands.node.status(onSuccess, onError);
```
    
### Using **Q** promises

```javascript
    var commands,
        promise;
        
    commands = require('sensorlab-commands')('observer-X.local', 5555, true);
    
    promise = commands.node.status();
    promise.then( function(status){ console.log('status: ', status) });
    
```
    
## License & Copyrights
Mozilla Public License Version 2.0 (MPL-2.0).
Copyright 2016 Orange
