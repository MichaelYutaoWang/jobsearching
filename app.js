/**
 * Module dependencies.
 */

var express = require('express'),
    routes = require('./routes'),
    user = require('./routes/user'),
    http = require('http'),
    path = require('path'),
    fs = require('fs'),
    async = require('async');

var XMLHttpRequest = require("xmlhttprequest").XMLHttpRequest;
var DomParser = require('dom-parser');
var createTextVersion = require("textversionjs");

var app = express();

var db;

var cloudant;

var fileToUpload;

var dbCredentials = {
    dbName: 'my_sample_db'
};

var bodyParser = require('body-parser');
var methodOverride = require('method-override');
var logger = require('morgan');
var errorHandler = require('errorhandler');
var multipart = require('connect-multiparty')
var multipartMiddleware = multipart();

// all environments
app.set('port', process.env.PORT || 3000);
app.set('views', __dirname + '/views');
app.set('view engine', 'ejs');
app.engine('html', require('ejs').renderFile);
app.use(logger('dev'));
app.use(bodyParser.urlencoded({
    extended: true
}));
app.use(bodyParser.json());
app.use(methodOverride());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/style', express.static(path.join(__dirname, '/views/style')));

// development only
if ('development' == app.get('env')) {
    app.use(errorHandler());
}

function getDBCredentialsUrl(jsonData) {
    var vcapServices = JSON.parse(jsonData);
    // Pattern match to find the first instance of a Cloudant service in
    // VCAP_SERVICES. If you know your service key, you can access the
    // service credentials directly by using the vcapServices object.
    for (var vcapService in vcapServices) {
        if (vcapService.match(/cloudant/i)) {
            return vcapServices[vcapService][0].credentials.url;
        }
    }
}

function initDBConnection() {
    //When running on Bluemix, this variable will be set to a json object
    //containing all the service credentials of all the bound services
    if (process.env.VCAP_SERVICES) {
        dbCredentials.url = getDBCredentialsUrl(process.env.VCAP_SERVICES);
    } else { //When running locally, the VCAP_SERVICES will not be set

        // When running this app locally you can get your Cloudant credentials
        // from Bluemix (VCAP_SERVICES in "cf env" output or the Environment
        // Variables section for an app in the Bluemix console dashboard).
        // Once you have the credentials, paste them into a file called vcap-local.json.
        // Alternately you could point to a local database here instead of a
        // Bluemix service.
        // url will be in this format: https://username:password@xxxxxxxxx-bluemix.cloudant.com
        dbCredentials.url = getDBCredentialsUrl(fs.readFileSync("vcap-local.json", "utf-8"));
    }

    cloudant = require('cloudant')(dbCredentials.url);

		/*
    // check if DB exists if not create
    cloudant.db.create(dbCredentials.dbName, function(err, res) {
        if (err) {
            console.log('Could not create new db: ' + dbCredentials.dbName + ', it might already exist.');
        }
    });
    db = cloudant.use(dbCredentials.dbName);
		*/
}

initDBConnection();

app.get('/', routes.index);

function createResponseData(id, name, value, attachments) {

    var responseData = {
        id: id,
        name: sanitizeInput(name),
        value: sanitizeInput(value),
        attachements: []
    };


    attachments.forEach(function(item, index) {
        var attachmentData = {
            content_type: item.type,
            key: item.key,
            url: '/api/favorites/attach?id=' + id + '&key=' + item.key
        };
        responseData.attachements.push(attachmentData);

    });
    return responseData;
}

function sanitizeInput(str) {
    return String(str).replace(/&(?!amp;|lt;|gt;)/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

var saveDocument = function(id, name, value, response) {

    if (id === undefined) {
        // Generated random id
        id = '';
    }

    db.insert({
        name: name,
        value: value
    }, id, function(err, doc) {
        if (err) {
            console.log(err);
            response.sendStatus(500);
        } else
            response.sendStatus(200);
        response.end();
    });

}

app.get('/api/favorites/attach', function(request, response) {
    var doc = request.query.id;
    var key = request.query.key;

    db.attachment.get(doc, key, function(err, body) {
        if (err) {
            response.status(500);
            response.setHeader('Content-Type', 'text/plain');
            response.write('Error: ' + err);
            response.end();
            return;
        }

        response.status(200);
        response.setHeader("Content-Disposition", 'inline; filename="' + key + '"');
        response.write(body);
        response.end();
        return;
    });
});

app.post('/api/favorites/attach', multipartMiddleware, function(request, response) {

    console.log("Upload File Invoked..");
    console.log('Request: ' + JSON.stringify(request.headers));

    var id;

    db.get(request.query.id, function(err, existingdoc) {

        var isExistingDoc = false;
        if (!existingdoc) {
            id = '-1';
        } else {
            id = existingdoc.id;
            isExistingDoc = true;
        }

        var name = sanitizeInput(request.query.name);
        var value = sanitizeInput(request.query.value);

        var file = request.files.file;
        var newPath = './public/uploads/' + file.name;

        var insertAttachment = function(file, id, rev, name, value, response) {

            fs.readFile(file.path, function(err, data) {
                if (!err) {

                    if (file) {

                        db.attachment.insert(id, file.name, data, file.type, {
                            rev: rev
                        }, function(err, document) {
                            if (!err) {
                                console.log('Attachment saved successfully.. ');

                                db.get(document.id, function(err, doc) {
                                    console.log('Attachements from server --> ' + JSON.stringify(doc._attachments));

                                    var attachements = [];
                                    var attachData;
                                    for (var attachment in doc._attachments) {
                                        if (attachment == value) {
                                            attachData = {
                                                "key": attachment,
                                                "type": file.type
                                            };
                                        } else {
                                            attachData = {
                                                "key": attachment,
                                                "type": doc._attachments[attachment]['content_type']
                                            };
                                        }
                                        attachements.push(attachData);
                                    }
                                    var responseData = createResponseData(
                                        id,
                                        name,
                                        value,
                                        attachements);
                                    console.log('Response after attachment: \n' + JSON.stringify(responseData));
                                    response.write(JSON.stringify(responseData));
                                    response.end();
                                    return;
                                });
                            } else {
                                console.log(err);
                            }
                        });
                    }
                }
            });
        }

        if (!isExistingDoc) {
            existingdoc = {
                name: name,
                value: value,
                create_date: new Date()
            };

            // save doc
            db.insert({
                name: name,
                value: value
            }, '', function(err, doc) {
                if (err) {
                    console.log(err);
                } else {

                    existingdoc = doc;
                    console.log("New doc created ..");
                    console.log(existingdoc);
                    insertAttachment(file, existingdoc.id, existingdoc.rev, name, value, response);

                }
            });

        } else {
            console.log('Adding attachment to existing doc.');
            console.log(existingdoc);
            insertAttachment(file, existingdoc._id, existingdoc._rev, name, value, response);
        }

    });

});

app.post('/api/favorites', function(request, response) {

    console.log("Create Invoked..");
    console.log("Name: " + request.body.name);
    console.log("Value: " + request.body.value);

    // var id = request.body.id;
    var name = sanitizeInput(request.body.name);
    var value = sanitizeInput(request.body.value);

    saveDocument(null, name, value, response);

});

app.delete('/api/favorites', function(request, response) {

    console.log("Delete Invoked..");
    var id = request.query.id;
    // var rev = request.query.rev; // Rev can be fetched from request. if
    // needed, send the rev from client
    console.log("Removing document of ID: " + id);
    console.log('Request Query: ' + JSON.stringify(request.query));

    db.get(id, {
        revs_info: true
    }, function(err, doc) {
        if (!err) {
            db.destroy(doc._id, doc._rev, function(err, res) {
                // Handle response
                if (err) {
                    console.log(err);
                    response.sendStatus(500);
                } else {
                    response.sendStatus(200);
                }
            });
        }
    });

});

app.put('/api/favorites', function(request, response) {

    console.log("Update Invoked..");

    var id = request.body.id;
    var name = sanitizeInput(request.body.name);
    var value = sanitizeInput(request.body.value);

    console.log("ID: " + id);

    db.get(id, {
        revs_info: true
    }, function(err, doc) {
        if (!err) {
            console.log(doc);
            doc.name = name;
            doc.value = value;
            db.insert(doc, doc.id, function(err, doc) {
                if (err) {
                    console.log('Error inserting data\n' + err);
                    return 500;
                }
                return 200;
            });
        }
    });
});

app.get('/api/favorites', function(request, response) {

    console.log("Get method invoked.. ")

    db = cloudant.use(dbCredentials.dbName);
    var docList = [];
    var i = 0;
    db.list(function(err, body) {
        if (!err) {
            var len = body.rows.length;
            console.log('total # of docs -> ' + len);
            if (len == 0) {
                // push sample data
                // save doc
                var docName = 'sample_doc';
                var docDesc = 'A sample Document';
                db.insert({
                    name: docName,
                    value: 'A sample Document'
                }, '', function(err, doc) {
                    if (err) {
                        console.log(err);
                    } else {

                        console.log('Document : ' + JSON.stringify(doc));
                        var responseData = createResponseData(
                            doc.id,
                            docName,
                            docDesc, []);
                        docList.push(responseData);
                        response.write(JSON.stringify(docList));
                        console.log(JSON.stringify(docList));
                        console.log('ending response...');
                        response.end();
                    }
                });
            } else {

                body.rows.forEach(function(document) {

                    db.get(document.id, {
                        revs_info: true
                    }, function(err, doc) {
                        if (!err) {
                            if (doc['_attachments']) {

                                var attachments = [];
                                for (var attribute in doc['_attachments']) {

                                    if (doc['_attachments'][attribute] && doc['_attachments'][attribute]['content_type']) {
                                        attachments.push({
                                            "key": attribute,
                                            "type": doc['_attachments'][attribute]['content_type']
                                        });
                                    }
                                    console.log(attribute + ": " + JSON.stringify(doc['_attachments'][attribute]));
                                }
                                var responseData = createResponseData(
                                    doc._id,
                                    doc.name,
                                    doc.value,
                                    attachments);

                            } else {
                                var responseData = createResponseData(
                                    doc._id,
                                    doc.name,
                                    doc.value, []);
                            }

                            docList.push(responseData);
                            i++;
                            if (i >= len) {
                                response.write(JSON.stringify(docList));
                                console.log('ending response...');
                                response.end();
                            }
                        } else {
                            console.log(err);
                        }
                    });

                });
            }

        } else {
            console.log(err);
        }
    });

});

http.createServer(app).listen(app.get('port'), '0.0.0.0', function() {
    console.log('Express server listening on port ' + app.get('port'));
});


//-------------------

var guserdb, euserdb, jobdb, jobwebsitedb, keyworddb
function useAllDatabases()
{
    guserdb = cloudant.use("guserdb");
    euserdb = cloudant.use("euserdb");
    jobdb = cloudant.use("jobdb");
    jobwebsitedb = cloudant.use("jobwebsitedb");
    keyworddb = cloudant.use("keyworddb");
}

useAllDatabases();

var guserDocList=[], euserDocList=[], jobDocList=[], jobwebsiteDocList=[], keywordDocList=[];

reloadDatabase();

function reloadDatabase()
{
	getKeywordDocList();
	getJobWebsiteDocList();
	getGeneralUserDocList();
	getEnterpriseUserDocList();
	getJobDocList();
}

//console.log("doc: "+JSON.stringify(doc));

function getKeywordDocList()
{
	keywordDocList = [];
	keyworddb.list(function(err, body) {
		if (!err) {
			if (body.rows.length > 0) {
				body.rows.forEach(function(document) {
					keyworddb.get(document.id, { revs_info: true	}, function(err, doc) {
						if (!err) {
							keywordDocList.push(doc);
						}});
					});
	     	}
    	}
  	});
}

function getJobDocList()
{
	jobDocList = [];
	jobdb.list(function(err, body) {
		if (!err) {
			console.log("Job list size: " + body.rows.length);
			if (body.rows.length > 0) {
				body.rows.forEach(function(document) {
					jobdb.get(document.id, { revs_info: true	}, function(err, doc) {
						if (!err) {
							jobDocList.push(doc);
						}});
					});
	     	}
    	}
  	});
}

function getJobWebsiteDocList()
{
	jobwebsiteDocList = [];
	jobwebsitedb.list(function(err, body) {
		if (!err) {
			if (body.rows.length > 0) {
				body.rows.forEach(function(document) {
					jobwebsitedb.get(document.id, { revs_info: true	}, function(err, doc) {
						if (!err) {
							jobwebsiteDocList.push(doc);
						}});
					});
	     	}
    	}
  	});
}

function getGeneralUserDocList()
{
	guserDocList = [];
	guserdb.list(function(err, body) {
		if (!err) {
			if (body.rows.length > 0) {
				body.rows.forEach(function(document) {
					guserdb.get(document.id, { revs_info: true	}, function(err, doc) {
						if (!err) {
							guserDocList.push(doc);
						}});
					});
	     	}
    	}
  	});
}

function updateGeneralUserDoc(userdata)
{
	for (var i = 0; i < guserDocList.length; i++) {
		var doc = guserDocList[i];
		if (doc._id == userdata._id) {
			doc = userdata;
			break;
		}
	}
}

function getGeneralUserDoc(id)
{
	for (var i = 0; i < guserDocList.length; i++) {
		var doc = guserDocList[i];
		if (id == doc._id) return doc;
	}
}
function checkGeneralUserExistsByID(id)
{
	for (var i = 0; i < guserDocList.length; i++) {
		var doc = guserDocList[i];
		if (id == doc._id) return true;
	}
	return false;
}
function checkGeneralUserExists(name)
{
	for (var i = 0; i < guserDocList.length; i++) {
		var doc = guserDocList[i];
		if (name ==doc.name) return true;
	}
	return false;
}
function checkGeneralUserExists2(id, name)
{
	for (var i = 0; i < guserDocList.length; i++) {
		var doc = guserDocList[i];
		if (id == doc._id && name ==doc.name) return true;
	}
	return false;
}

function checkGeneralUserPassword(name, password)
{
	for (var i = 0; i < guserDocList.length; i++) {
		var doc = guserDocList[i];
		if (name ==doc.name && password == doc.password) return true;
	}
	return false;
}

function getEnterpriseUserDocList()
{
	euserDocList = [];
	euserdb.list(function(err, body) {
		if (!err) {
			if (body.rows.length > 0) {
				body.rows.forEach(function(document) {
					euserdb.get(document.id, { revs_info: true	}, function(err, doc) {
						if (!err) {
							euserDocList.push(doc);
						}});
					});
	     	}
    	}
  	});
}

function updateEnterpriseUserDoc(userdata)
{
	for (var i = 0; i < euserDocList.length; i++) {
		var doc = euserDocList[i];
		if (doc._id == userdata._id) {
			doc = userdata;
		}
	}
}

function getEnterpriseUserDoc(id)
{
	for (var i = 0; i < euserDocList.length; i++) {
		var doc = euserDocList[i];
		if (id == doc._id) return doc;
	}
}
function checkEnterpriseUserExistsByID(id)
{
	for (var i = 0; i < euserDocList.length; i++) {
		var doc = euserDocList[i];
		if (id == doc._id) return true;
	}
  return false;
}
function checkEnterpriseUserExists(name)
{
	for (var i = 0; i < euserDocList.length; i++) {
		var doc = euserDocList[i];
		if (name == doc.name) return true;
	}
  return false;
}
function checkEnterpriseUserExists2(id, name)
{
	for (var i = 0; i < euserDocList.length; i++) {
		var doc = euserDocList[i];
		if (id == doc._id && name == doc.name) return true;
	}
  return false;
}

function checkEnterpriseUserPassword(name, password)
{
	for (var i = 0; i < euserDocList.length; i++) {
		var doc = euserDocList[i];
		if (name ==doc.name && password == doc.password) return true;
	}
  return false;
}

function printList(listname, list)
{
	console.log(listname+" : "+list.length);
	for (var i = 0; i < list.length; i++) {
		console.log("    "+JSON.stringify(list[i]));
	}
}

app.all('/reload_database', function(request, response) {
	console.log("reload database ...");
	reloadDatabase();
	response.status(200);
  response.setHeader("content-type",  "text/html; charset=utf-8");
  response.write("OK")
  response.end();
});

app.post('/login_administrator', function(request, response) {
	if (request.body.username!="admin" || request.body.password!="admin123") {
		response.redirect('/');
		return;
	}
		
	var filename = __dirname + "/public/index_administrator.html";
	var fileContent = fs.readFileSync(filename, "utf8");
	//fileContent = fileContent.replace(/##test##/g, "this is a test!!!");
	
	var htmlText = "";
	for (var i = 0; i < jobwebsiteDocList.length; i++) {
		var doc = jobwebsiteDocList[i];
		htmlText += "<li><a href=\"#\" title=\"" + doc.desc + "\">" + doc.jobwebsite + "</a></li>";
	}
	fileContent = fileContent.replace("<!-- ##JobWebsites## -->", htmlText);
	
	htmlText = "";
	if (keywordDocList.length > 0) {
		var keywords = keywordDocList[0].keywords.split(",");
		for (var i = 0; i < keywords.length; i++) {
			htmlText += "<li><a href=\"#\">"+keywords[i]+"</a></li>";
		}
	}
	fileContent = fileContent.replace("<!-- ##JobKeywords## -->", htmlText);
	
	htmlText = "";
	for (var i = 0; i < jobDocList.length; i++) {
		var doc = jobDocList[i];
		var jobInfo = "Keywords: " + doc.keywords + "\nDescription:\n" + doc.job;
		var jobItemName = "Job " + (i+1);
		htmlText += "<li><a href=\"#\" title=\"" + jobInfo + "\">" + jobItemName + "</a></li>";
	}
	fileContent = fileContent.replace("<!-- ##JobList## -->", htmlText);
	
	htmlText = "";
	for (var i = 0; i < guserDocList.length; i++) {
		var doc = guserDocList[i];
		var title = "Email: " + doc.email + "\n";
		title += "Keywords: " + doc.keywords + "\n";
		title += "CV: " + doc.cv + "\n";
		htmlText += "<li><a href=\"#\" title=\"" + title + "\">" + doc.name + "</a></li>";
	}
	fileContent = fileContent.replace("<!-- ##GeneralUsers## -->", htmlText);
	
	htmlText = "";
	for (var i = 0; i < euserDocList.length; i++) {
		var doc = euserDocList[i];
		var title = "";
		title += "Phone: " + doc.phone + "\n";
		title += "Email: " + doc.email + "\n";
		title += "Address: " + doc.address + "\n";
		title += "Keywords: " + doc.keywords + "\n";
		title += "Job Number: " + doc.jobnumber + "\n";
		for (var j = 1; j <= doc.jobnumber; j++) {
			var keywordname = "keyword_" + j;
			var jobname = "job_" + j;
			title += jobname + ": ( " + doc[keywordname] + " )\n  " + doc[jobname] + "\n";
		}
		htmlText += "<li><a href=\"#\" title=\"" + title + "\">" + doc.name + "</a></li>";
	}
	fileContent = fileContent.replace("<!-- ##EnterpriseUsers## -->", htmlText);

	response.status(200);
  response.setHeader("content-type",  "text/html; charset=utf-8");
  response.write(fileContent)
  response.end();
});

function do_login_general_user(username, response)
{
	var filename = __dirname + "/public/index_general_user.html";
	var fileContent = fs.readFileSync(filename, "utf8");
	
	for (var i = 0; i < guserDocList.length; i++) {
		var doc = guserDocList[i];
		if (doc.name == username) {
			fileContent = fileContent.replace("##ID##", doc._id);
			fileContent = fileContent.replace(/##NAME##/g, doc.name);
			fileContent = fileContent.replace(/##PASSWORD##/g, doc.password);
			fileContent = fileContent.replace("##PHONE##", doc.phone);
			fileContent = fileContent.replace("##EMAIL##", doc.email);
			fileContent = fileContent.replace("##KEYWORDS##", doc.keywords);
			fileContent = fileContent.replace("##CV##", doc.cv);
			
			var keywords = [];
			if (doc.keywords.length > 0) {
				keywords = doc.keywords.split(",");
			}
    	var info = "";
			
			// euserdb
			for (var j = 0; j < euserDocList.length; j++) {
				var edoc = euserDocList[j];
				var keywordExists = false;
				for (var k = 0; k < keywords.length; k++) {
					if (edoc.keywords.includes(keywords[k])) {
						keywordExists = true;
						break;
					}
				}
				if (keywordExists) {
					// loop for jobs
					for (var j2 = 1; j2 <= edoc.jobnumber; j2++) {
						var keywordname = "keyword_" + j2;
						var jobname = "job_" + j2;
						var info_temp = "<tr><td><textarea cols=\"110\" rows=\"6\">##KEYWORDS##\n ##JOBINFORMATION##</textarea></td></tr>";
						info_temp = info_temp.replace("##KEYWORDS##", edoc[keywordname]);
						info_temp = info_temp.replace("##JOBINFORMATION##", edoc[jobname]);
						info += info_temp;
					}
				}
			}
			
			// jobdb
			for (var j = 0; j < jobDocList.length; j++) {
				var jdoc = jobDocList[j];
				var keywordExists = false;
				for (var k = 0; k < keywords.length; k++) {
					if (jdoc.keywords.includes(keywords[k])) {
						keywordExists = true;
						break;
					}
				}
				if (keywordExists) {
					var info_temp = "<tr><td><textarea cols=\"110\" rows=\"6\">##KEYWORDS##\n ##JOBINFORMATION##</textarea></td></tr>";
					info_temp = info_temp.replace("##KEYWORDS##", jdoc.keywords);
					info_temp = info_temp.replace("##JOBINFORMATION##", jdoc.job);
					info += info_temp;
				}
			}
			fileContent = fileContent.replace("<!--##JOBINFORMATION##-->", info);
			break;
		}
	}
	
	response.status(200);
  response.setHeader("content-type",  "text/html; charset=utf-8");
  response.write(fileContent)
  response.end();
}

app.post('/login_general_user', function(request, response) {
	if (!checkGeneralUserPassword(request.body.username, request.body.password)) {
		console.log("Warning: username or password is not correct.");
		response.redirect('/');
	} else {
		do_login_general_user(request.body.username, response);
	}
});

app.post('/register_general_user', function(request, response) {
	if (!checkGeneralUserExists(request.body.username)) {
		var userdata = {name: request.body.username, password: request.body.password,	phone: "", email: "", keywords: "", cv: "" };
		guserdb.insert(userdata,
			function(err, data) {
    		if (!err) {
    			guserDocList.push(userdata);
    			do_login_general_user(request.body.username, response);
    			getGeneralUserDocList();
    		}
	  	});
	} else if (checkGeneralUserPassword(request.body.username, request.body.password)) {
		do_login_general_user(request.body.username, response);
	} else {
		response.redirect('/');
	}
});

app.post('/update_general_user', function(request, response) {
	if (checkGeneralUserExists2(request.body._id, request.body.username2) ||
			(checkGeneralUserExistsByID(request.body._id) && !checkGeneralUserExists(request.body.username2)) )
	{
		// update by username2, password2
		var userdata = getGeneralUserDoc(request.body._id);
		if (userdata)
		{
			userdata._revs_info = "";
			userdata.name = request.body.username2;
			userdata.password = request.body.password2;
			userdata.phone = request.body.phone;
			userdata.email = request.body.email;
			userdata.keywords = request.body.keywords;
			userdata.cv = request.body.cv;
			
			console.log("userdata:" + JSON.stringify(userdata));
			guserdb.insert(userdata, function(err, data) {
				console.log("Error: "+ err + ", data: " + data);
					if (!err) {
						updateGeneralUserDoc(userdata);
		    		do_login_general_user(request.body.username2, response);
		    	} else {
		    		console.log("--- ERROR1 ---");
		    		do_login_general_user(request.body.username, response);
		    	}
			  });
		} else {
			console.log("--- ERROR2 ---");
			do_login_general_user(request.body.username, response);
		}
		
	} else if (checkGeneralUserPassword(request.body.username, request.body.password)) {
		do_login_general_user(request.body.username2, response);
	} else {
		response.redirect('/');
	}
});

function getMatchedUsers(keyword)
{
	var info = "";
	for (var i = 0; i < guserDocList.length; i++) {
		var doc = guserDocList[i];
		if (doc.keywords.includes(keyword)) {
			info += doc.name + "\n";
		}
	}
	return info;
}

function do_login_enterprise_user(username, response)
{
	var filename = __dirname + "/public/index_enterprise_user.html";
	var fileContent = fs.readFileSync(filename, "utf8");
	
	for (var i = 0; i < euserDocList.length; i++) {
		var doc = euserDocList[i];
		if (doc.name == username) {
			fileContent = fileContent.replace("##ID##", doc._id);
			fileContent = fileContent.replace(/##NAME##/g, doc.name);
			fileContent = fileContent.replace(/##PASSWORD##/g, doc.password);
			fileContent = fileContent.replace("##PHONE##", doc.phone);
			fileContent = fileContent.replace("##EMAIL##", doc.email);
			fileContent = fileContent.replace("##ADDRESS##", doc.address);
			fileContent = fileContent.replace("##KEYWORDS##", doc.keywords);
			// loop for jobs
			var info = "";
			for (var j = 1; j <= doc.jobnumber; j++) {
				var keywordname = "keyword_" + j;
				var jobname = "job_" + j;
				var keyword = doc[keywordname];
				var users = getMatchedUsers(keyword);
				var info_temp = "<tr><td><textarea name=\"keyword_job_##NO##\" cols=\"20\" rows=\"5\">##KEYWORDS##</textarea><a href=\"#\"><img src=\"images/user1.png\" title=\"##USERS##\" /></a></td><td><textarea name=\"job_##NO##\" cols=\"80\" rows=\"5\">##JOBINFORMATION##</textarea></td></tr>";
				info_temp = info_temp.replace(/##NO##/g, j);
				info_temp = info_temp.replace("##USERS##", users);
				info_temp = info_temp.replace("##KEYWORDS##", keyword);
				info_temp = info_temp.replace("##JOBINFORMATION##", doc[jobname]);
				info += info_temp;
			}
  		fileContent = fileContent.replace("<!--##JOBINFORMATION##-->", info);
			break;
		}
	}
	
	response.status(200);
  response.setHeader("content-type",  "text/html; charset=utf-8");
  response.write(fileContent)
  response.end();
}

app.post('/login_enterprise_user', function(request, response) {
	if (!checkEnterpriseUserPassword(request.body.username, request.body.password)) {
		console.log("Warning: username or password is not correct.");
		response.redirect('/');
	} else {
		do_login_enterprise_user(request.body.username, response);
	}
});

app.post('/register_enterprise_user', function(request, response) {
	if (!checkEnterpriseUserExists(request.body.username)) {
		var userdata = {name: request.body.username, password: request.body.password,	phone: "", email: "", 
				address: "", keywords: "", jobnumber: "0" };
		euserdb.insert(userdata,
			function(err, data) {
    		if (!err) {
    			euserDocList.push(userdata);
    			do_login_enterprise_user(request.body.username, response);
    			getEnterpriseUserDocList();
    		}
	  	});
	} else if (checkEnterpriseUserPassword(request.body.username, request.body.password)) {
		do_login_enterprise_user(request.body.username, response);
	} else {
		response.redirect('/');
	}
});

app.post('/update_enterprise_user', function(request, response) {
	if (checkEnterpriseUserExists2(request.body._id, request.body.username2) ||
			(checkEnterpriseUserExistsByID(request.body._id) && !checkEnterpriseUserExists(request.body.username2)) )
	{
		// update by username2, password2
		var userdata = getEnterpriseUserDoc(request.body._id);
		if (userdata)
		{
			userdata._revs_info = "";
			userdata.name = request.body.username2;
			userdata.password = request.body.password2;
			userdata.phone = request.body.phone;
			userdata.email = request.body.email;
			userdata.address = request.body.address;
			userdata.keywords = request.body.keywords;

			console.log("userdata:" + JSON.stringify(userdata));
			euserdb.insert(userdata, function(err, data) {
				console.log("Error: "+ err + ", data: " + data);
					if (!err) {
						updateEnterpriseUserDoc(userdata);
		    		do_login_enterprise_user(request.body.username, response);
		    	} else {
		    		console.log("--- ERROR1 ---");
		    		do_login_enterprise_user(request.body.username, response);
		    	}
				});
		} else {
			console.log("--- ERROR2 ---");
			do_login_enterprise_user(request.body.username, response);
		}
	} else if (checkEnterpriseUserPassword(request.body.username, request.body.password)) {
		do_login_enterprise_user(request.body.username2, response);
	} else {
		response.redirect('/');
	}
});

// job searching
var searchStatus = 0; // 0: stop, 1: running
var searchInfo = "";

app.all('/get_searching_status', function(request, response) {
	response.status(200);
  response.setHeader("content-type",  "text/html; charset=utf-8");
  var statusInfo = (searchStatus == 0) ? "Stop" : "Running";
 	response.write(statusInfo);
  response.end();
});

app.all('/get_searching_info', function(request, response) {
	response.status(200);
  response.setHeader("content-type",  "text/html; charset=utf-8");
  if (searchInfo.length == 0) {
  	response.write("No status information.");
  } else {
  	response.write(searchInfo);
  }
  response.end();
});

app.all('/stop_searching', function(request, response) {
	if (searchStatus == 1) {
		searchStatus = 0;
	}
	response.status(200);
  response.setHeader("content-type",  "text/html; charset=utf-8");
 	response.write("OK");
  response.end();
});

app.all('/start_searching', function(request, response) {
	var statusInfo = "OK";
	if (searchStatus == 0)
	{
		//statusInfo = "This module is not ready!";	
		if (keywordDocList.length > 0) {
			var doc = keywordDocList[0];
			if (doc.keywords.length > 0) {
				statusInfo = "Searching jobs. keywords are " + doc.keywords + ".";
				searchStatus = 1;
				var keywords = doc.keywords.split(",");
				console.log("keyword number: " + keywords.length);
				for (var i = 0; i < keywords.length; i++) {
					var keyword = keywords[i];
					console.log("searching, i: " + i + ", keyword: " + keyword);
					var xmlhttp = new XMLHttpRequest();
				  var url = "https://www.seek.co.nz/" + keyword + "-jobs";
				  xmlhttp.open("GET", url, false);
				  xmlhttp.send();
	  	  	setJobData(keyword, xmlhttp.responseText);
				}
				searchStatus = 0;
				searchInfo += "\nSearching finished.\n";
				getJobDocList();
			}
		}
	}
	
	response.status(200);
  response.setHeader("content-type",  "text/html; charset=utf-8");
 	response.write(statusInfo);
  response.end();
});

function setJobData(keyword, html)
{	
	var parser = new DomParser();
  var dom = parser.parseFromString(html);

	var jobDataBlocks = dom.getElementsByTagName("article");
	for (var i = 0; i < jobs.length; i++) {
		var text = createTextVersion(jobDataBlocks[i].innerHTML);
		var userdata = { "keywords": keyword, "job": text};
		jobdb.insert(userdata,
			function(err, data) {
    		if (!err) {
    			console.log("insert keyword: " + keyword + ", seq:" + i + ", total: " + jobs.length);
    		}
	  	});
	}
}

//-------------------
