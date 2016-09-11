# s3load
Simple Data Loader for S3 - Scales to millions of objects. 
AWS S3 - because of rate limiting on S3 buckets, number of objects may be lesser
Does not retry on failed puts


```
usage: s3load --cmd {pb,db,put,get,del}   [--config {configFile}]
           cmd:    pb=put bucket, db=delete bucket, put=put object, get=get object,del= delete object
           config file: 
               default: ./s3load.config
               format: head -n 25 /Users/vardhan/play/nodejs/s3load/s3load.js
```

Config file looks like the following:
```
{
   "endpoint"       : "https://your-s3-endpoint",
   "accessId"       : "",
   "secretKey"      : "",
		
   "bucketBody"   : "MyBucketTest",
   "bucketSuffixStart" : 1,
   "bucketSuffixEnd"   : 1,

   "objectBody"   : "myObj",
   "objectSuffixStart" : 1,
   "objectSuffixEnd"   : 10000,
   
   "size" :  16384,

   "_help_comment_" : ["The above, with --cmd put, will create 10,000, Size is in bytes",
			     "             MyBucketTest1 \\ myObj1",
			     "             MyBucketTest2 \\ myObj10000"]
 }
```
This file will create 
1 Buckets ( MyBucketTest1 ) each bucket having 10,000 objects (myObj1..myObj10000) of 16KB each
