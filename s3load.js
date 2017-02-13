#! /usr/bin/env node --stack-trace-limit=0

/*---- config file format - copy and save in another file
{
   "endpoint"       : "https://your-s3-endpoint",
   "accessId"       : "",
   "secretKey"      : "",
		
   "bucketBody"   : "myBkt",
   "bucketSuffixStart" : 1,
   "bucketSuffixEnd"   : 2,
   
   "objectBody"   : "myObj",
   "objectSuffixStart" : 1,
   "objectSuffixEnd"   : 2,
   
   "size" : 0,
    
   "_help_comment_" : ["This config with --cmd put, will create 4 objects",
			     "             myBkt1 \\ myObj1",
			     "             myBkt1 \\ myObj2",
			     "             myBkt2 \\ myObj1",
			     "             myBkt2 \\ myObj2"]
				 
 }
 ------*/


// imports
var AWS = require('aws-sdk');
var minimist = require('minimist')
var fs = require('fs')
var http = require('http');

// to debug $ export DEBUG=INFO 
const debug_log  = require('debug')("INFO")


// get cmdline
var cmdLine = checkUsage(process.argv.splice(2))

// read config file
try {
	var s3loadConfig = JSON.parse(fs.readFileSync(cmdLine.config))
} catch (err) {
	console.error(err.message)
	printUsage()
	process.exit(1)
}

checkConfigFile(s3loadConfig)
		
const dataBuffer = Buffer.allocUnsafe(s3loadConfig.size)

// configure AWS
AWS.config.credentials = new AWS.Credentials (s3loadConfig.accessId,s3loadConfig.secretKey)
AWS.config.s3ForcePathStyle = true




AWS.config.update ( {
	httpOptions: {
		keepAlive: true,
		keepAliveMsecs: 10000
	}
})

var s3 = new AWS.S3({endpoint: s3loadConfig.endpoint});


//Used to keep track of where we are in the tasks
var currBktIndx = s3loadConfig.bucketSuffixStart
var currObjIndx = s3loadConfig.objectSuffixStart



//Used to manage total number of tasks so we don't end up with a 
//stack overflow when dealing with millions of objects
var upperTaskBound = 2000
var lowerTaskBound = 1000
var runningTasks   = 0
var tasksComplete  = false


//create actions to execute
var putAction = refillTaskList.bind(undefined,currBktIndx,currObjIndx, timedPutObject)
var getAction = refillTaskList.bind(undefined,currBktIndx,currObjIndx, timedGetObject)
var delAction = refillTaskList.bind(undefined,currBktIndx,currObjIndx, timedDelObject)


const cmdTable = {
		"pb" : putBuckets,
		"db" : deleteBuckets,
		"put": putAction,
		"get": getAction,
		"del": delAction
}

debug_log("executing: " + cmdLine.cmd)

cmdTable[cmdLine.cmd]()


// END - rest are functions ---




// controlled taskexecution
function refillTaskList (bktStartIndx, objStartIndx, taskFn) {
	
	var j = bktStartIndx
	var i = objStartIndx	
	
	debug_log(":refillTaskList:(%d,%d)",j,i)
	
	for (j= bktStartIndx; j < s3loadConfig.bucketSuffixEnd+1 && 
					 tasksComplete == false ; j++) {
		
		debug_log("starting task for bucket: ",j)

		// weird loop - continuing from where we left before, but need to cycle back
		for( i ; (i < s3loadConfig.objectSuffixEnd+1) && (runningTasks < upperTaskBound) ; i++) {

			  currBktIndx = j
			  currObjIndx = i
			  
			  // this is the last task - no future refilling needed
			  if (currBktIndx == s3loadConfig.bucketSuffixEnd && 
					  currObjIndx == s3loadConfig.objectSuffixEnd)
				  tasksComplete = true
				  
			  // starting a task
		      debug_log("task for bucket: " + j + " object: " + i)
			  runningTasks++			  
			  taskFn(j,i)
		}
		i = 1; // see weird loop comment above
	}
		
	if (tasksComplete)
		debug_log("----All tasks complete ---")
}




// create bucket
function putBuckets() {
	for (var j=s3loadConfig.bucketSuffixStart; j < s3loadConfig.bucketSuffixEnd+1; j++) {
		timedCreateBucket(j)
	}	
}

function timedCreateBucket(bktSuffix) {
	var localSentTime = Date.now()
	var params = {Bucket: s3loadConfig.bucketBody+bktSuffix};

	s3.createBucket ( params, function(err, data) {
		if (err)
			console.log(err)
		else {
			var localRcvTime = Date.now()
			var latency = localRcvTime - localSentTime

			console.log("PUT-BUCKET," + this.request.params.Bucket + ',' + latency);
		}		
	})		
}


//function needs to be in one block to maintain context
function timedPutObject(  bktSuffix, objSuffix ) {
	
	debug_log(":timedPutObject")
	var localSentTime = Date.now()
	var params = {Bucket: s3loadConfig.bucketBody+bktSuffix, 
					 Key: s3loadConfig.objectBody+objSuffix,
					 Body: dataBuffer
				 }
	
	s3.putObject(params, function(err, data) {
		if (err)
			console.log(err)
		else {
			var localRcvTime = Date.now()
			var latency = localRcvTime - localSentTime

			console.log("PUT," + this.request.params.Bucket + '/'
					+ this.request.params.Key + ',' + latency);
		}
		// one job done
		runningTasks--;
		
		// see if we should top-up the number of running tasks
		if (runningTasks <= lowerTaskBound && tasksComplete == false)
			refillTaskList(currBktIndx,currObjIndx, timedPutObject)
		
	});
}




//function needs to be in one block to maintain context
function timedGetObject(  bktSuffix, objSuffix ) {
	
	var localSentTime = Date.now()
	var params = {Bucket: s3loadConfig.bucketBody +bktSuffix, 
					Key: s3loadConfig.objectBody+ objSuffix};	
	
	s3.getObject(params, function(err, data) {
		if (err)
			console.log(err)
		else {
			var localRcvTime = Date.now()
			var latency = localRcvTime - localSentTime

			console.log("GET," + this.request.params.Bucket + '/'
					+ this.request.params.Key + ',' +  latency);
		}
		// one job done
		runningTasks--;
		
		// see if we should top-up the number of running tasks
		if (runningTasks <= lowerTaskBound && tasksComplete == false)
			refillTaskList(currBktIndx,currObjIndx, timedGetObject)
		
	});
}



//function needs to be in one block to maintain context
function timedDelObject( bktSuffix, objSuffix) {
	
	var localSentTime = Date.now()
	var params = {Bucket: s3loadConfig.bucketBody+bktSuffix, 
					Key: s3loadConfig.objectBody+ objSuffix};
	
	s3.deleteObject(params, function(err, data) {
		if (err)
			console.log(err)
		else {
			var localRcvTime = Date.now()
			var latency = localRcvTime - localSentTime

			console.log("DELETE," + this.request.params.Bucket + '/'
					+ this.request.params.Key + ',' +  latency);
		}
		// one job done
		runningTasks--;
		
		// see if we should top-up the number of running tasks
		if (runningTasks <= lowerTaskBound && tasksComplete == false)
			refillTaskList(currBktIndx,currObjIndx, timedDelObject)
	});
}



//create container
function deleteBuckets() {
	for (var j=s3loadConfig.bucketSuffixStart; j < s3loadConfig.bucketSuffixEnd+1; j++)		
		timedDeleteBucket(j)
}

function timedDeleteBucket(bktSuffix) {
	var localSentTime = Date.now()
	var params = {Bucket: s3loadConfig.bucketBody+bktSuffix};
	
	s3.deleteBucket ( params, function(err, data) {
		if (err)
			console.log(err)
		else {
			var localRcvTime = Date.now()
			var latency = localRcvTime - localSentTime

			console.log("DEL-BUCKET," + this.request.params.Bucket + "," + latency);
		}		
	})		
}



function checkUsage(cmdLine) {
	
	var cmdLineStatus = true
	
	var args = minimist(cmdLine, {
			string: ['cmd', 'config'],
			default: { 
					   config: "./s3load.config"
					  },
			unknown: function(x) { console.error("unknown option: " + x); cmdLineStatus = false ; return false }
	})
	if (cmdLineStatus == false || checkProcessedCmdLine(args) == false) {
		printUsage()
		debug_log(args)
		process.exit(1)
	}

	debug_log(args)
	
	return args
		
	function checkProcessedCmdLine(pArgs) {
		debug_log(":checkProcessedCmdLine")
		
		if (pArgs._.length !=  0) {
			console.error("incorrect number of arguments, or unnecessary arguments") 			
			return false
		} else if ( typeof(pArgs.cmd)   != "string" ) {
			console.error("cmd not specified") 			
			return false		
		} else if (typeof(pArgs.config)  != "string") {
			console.error("config file not specified") 			
			return false
		}
		
		if(pArgs.cmd !== "pb" && 
				pArgs.cmd !== "db" &&
				pArgs.cmd !== "put" &&
				pArgs.cmd !== "get" &&
				pArgs.cmd !== "del"
				) {
			console.error("invalid cmd")
			return false			
		}		
	}

}



function printUsage() {
	console.error ("usage: s3load --cmd {pb,db,put,get,del}   [--config {configFile}]" +
			     "\n           cmd:    pb=put bucket, db=delete bucket, put=put object, get=get object,del= delete object" +
			     "\n           config file: " +
			     "\n               default: ./s3load.config" +
			     "\n               format: head -n 25 " + process.argv[1]
			     )
}

function checkConfigFile( configParam ) {
	
	debug_log("config is: ", configParam)
	if (configParam.bucketSuffixStart < 1 ||
			configParam.bucketSuffixEnd < 1 ||
			configParam.bucketSuffixStart > configParam.bucketSuffixEnd ||
			(configParam.bucketSuffixEnd - configParam.bucketSuffixStart) > 100 ||

			configParam.objectSuffixStart < 1 ||
			configParam.objectSuffixEnd < 1 ||
			configParam.objectSuffixStart > configParam.objectSuffixEnd ||
			(configParam.objectSuffixEnd - configParam.objectSuffixStart) > 1000000000)
			{
				console.error("Number of buckets or objects out of bounds")
				printUsage()
				process.exit(1)
			}
	return true
}

