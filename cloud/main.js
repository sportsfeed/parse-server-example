
var twilioAccountSid = process.env.TWILLIO_SID;
var twilioAuthToken = process.env.TWILLIO_TOKEN;
var twilioPhoneNumber = process.env.TWILLIO_FROM_NUMBER;
var secretPasswordToken = process.env.LOGIN_SECRET;
var demoPhoneNumber = '14155551234';
var demoPassword = '1234';

var firebaseSendersBaseUrl = process.env.FIREBASE_SENDERS_URL;
var firebaseKey = process.env.FIREBASE_KEY;

var twilio = require('twilio')(twilioAccountSid, twilioAuthToken);

Parse.Cloud.define("sendCode", function(req, res) {
	if (!req.params.phoneNumber || req.params.phoneNumber.length != 11) return res.error('Invalid Parameters');
	Parse.Cloud.useMasterKey();
	var query = new Parse.Query(Parse.User);
	query.equalTo('username', req.params.phoneNumber + "");
	query.first().then(function(result) {
		var min = 1000; var max = 9999;
		var num = Math.floor(Math.random() * (max - min + 1)) + min;
    
    if (req.params.phoneNumber === demoPhoneNumber) {
      num = demoPassword;
    }

		if (result) {
			result.setPassword(secretPasswordToken + num);
			result.save().then(function() {
				return sendCodeSms(req.params.phoneNumber, num);
			}).then(function() {
				res.success();
			}, function(err) {
				res.error(err);
			});
		} else {
			var user = new Parse.User();
			user.setUsername(req.params.phoneNumber);
			user.setPassword(secretPasswordToken + num);
			user.setACL({}); 
			user.save().then(function(a) {
          return sendCodeSms(req.params.phoneNumber, num);
			}).then(function() {
				res.success();
			}, function(err) {
				res.error(err);
			});
		}
	}, function (err) {
		res.error(err);
	});
});

Parse.Cloud.define("logIn", function(req, res) {
	Parse.Cloud.useMasterKey();
  if (req.params.phoneNumber === demoPhoneNumber) {
		Parse.User.logIn(req.params.phoneNumber, secretPasswordToken + demoPassword).then(function (user) {
			res.success(user._sessionToken);
		}, function (err) {
			res.error(err);
		});
  } else {
  	if (req.params.phoneNumber && req.params.codeEntry) {
  		Parse.User.logIn(req.params.phoneNumber, secretPasswordToken + req.params.codeEntry).then(function (user) {
  			res.success(user._sessionToken);
  		}, function (err) {
  			res.error(err);
  		});
  	} else {
  		res.error('Invalid parameters.');
  	}
  }
});

Parse.Cloud.define("inviteUser", function(req, res) {
  Parse.Cloud.useMasterKey();
  var username  = req.params.phoneNumber + "";
  
	var query = new Parse.Query(Parse.User);
	query.equalTo('username',  username);
  query.first().then(function(result) {
    if (result) {
      var message = req.params.message;
      // Send a push notification
      var pushQuery = new Parse.Query(Parse.Installation);
      pushQuery.equalTo("user", result);
      Parse.Push.send({
        where: pushQuery,
        data: {
          alert: message,
          scores: 1,
          group: "invite"
        }
      }, { useMasterKey: true }).then(function() {
        res.success("Invite sent successfully.");
      }, function(error) {
        res.error("Invite failed to send with error: " + error.message);
      });
    } else {
      // Return with an error (so we can fall back to SMS on client)
      res.error("User doesn't exist");
    }
  }, function (err) {
    res.error(err);
	});
});


Parse.Cloud.define("sendMessageAlert", function(req, res) {
  Parse.Cloud.useMasterKey();
  var gameId    = req.params.gameId;  
  var groupId   = req.params.groupId;
  var parentId  = req.params.parentId;
  var message   = req.params.message;
  
  // Apple has a conservative upper bound on alert payload size
  // So just take first 137 chars & add ellipsis if over 140
  if (message.length > 140) {
    // Truncate and add a ...
      message = message.substring(0, 137) + "...";
  }
  
  sendGroupAlert(res, gameId, groupId, parentId, message, true);
});

function sendCodeSms(phoneNumber, code) {
	var promise = new Parse.Promise();
	twilio.sendSms({
		to: '+' + phoneNumber,
		from: twilioPhoneNumber,
		body: 'Your Sports Feed code is ' + code
	}, function(err, responseData) {
		if (err) {
			console.log(err);
			promise.reject(err.message);
		} else {
			promise.resolve();
		}
	});
	return promise;
}

function sendGroupAlert(res, gameId, groupId, parentId, message, retry) {
  var senderIds = [];  
  Parse.Cloud.httpRequest({
    url: firebaseSendersBaseUrl + "/" + groupId + ".json?auth=" + firebaseKey,
    success: function(httpResponse) {
      var senders = httpResponse.data;
      // httpResponse.data example:
      //   { "14152642004" : {"parent" : "", "muted" : ..., } }
      for (var senderId in senders) {
        if (senders.hasOwnProperty(senderId)) {
          var senderMeta = senders[senderId];
          // Don't send alert to parent or muted senders
          if (!(senderId === parentId) && !senderMeta["muted"]) {
            senderIds.push(senderId);
          }
        }
      }
      // Send a targeted push notification
      // Find users
      var userQuery = new Parse.Query(Parse.User);
      userQuery.containedIn("username", senderIds);
      var pushQuery = new Parse.Query(Parse.Installation);
      pushQuery.matchesQuery('user', userQuery);
      // Send alerts to installations
      Parse.Push.send({
        where: pushQuery,
        data: {
          alert: message,
          badge: "Increment",
          scores : 1,
          group: "message",
          game_id: gameId,
          group_id: groupId
        }
      }, {
        useMasterKey: true,
        success: function() {
          res.success("Alert sent successfully.");
        },
        error: function(error) {
          res.error("Alert failed to send with error: " + error.message);
        }
      });
    },
    error: function(httpResponse) {
      if (retry) {
        sendGroupAlert(res, gameId, groupId, parentId, message, false);
      } else {
        res.error("Request to Firebase failed :" + httpResponse.status);
      }
    }
  });
}