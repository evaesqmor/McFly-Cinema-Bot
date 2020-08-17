// See https://github.com/dialogflow/dialogflow-fulfillment-nodejs
// for Dialogflow fulfillment library docs, samples, and to report issues
'use strict';
 
//Define Firebase

const functions = require('firebase-functions');
const {WebhookClient} = require('dialogflow-fulfillment');
const {Card, Suggestion} = require('dialogflow-fulfillment');


//Conection to Firebase Database
const admin = require('firebase-admin');
admin.initializeApp({
	credential: admin.credential.applicationDefault(),
  	databaseURL: 'ws://mcflyentertainmentbot-bxcc.firebaseio.com/'
});
 
process.env.DEBUG = 'dialogflow:debug'; // enables lib debugging statements
 
exports.dialogflowFirebaseFulfillment = functions.https.onRequest((request, response) => {
  const agent = new WebhookClient({ request, response });
  var database = admin.database();
  var generalRef = database.ref("users");
   
  function handleGetPassword(agent){
    const username= agent.parameters.username;
    const password = agent.parameters.password;
    agent.add(`Has sido registrado correctamente, ${username}`);
    generalRef.child(username).set({
      password: password,
    });
  }
  
  function handleLoginPassword(agent){
    const username= agent.parameters.username;
    const password = agent.parameters.password;
    console.log("USERNAME",username);
    let userRef = database.ref("users/"+username);
    /*Reading & writing from the database*/
    return userRef.transaction(user => {
      console.log(user);
      if(user!=null){
        let storedPassword = user.password;
        console.log("STOREDPASS",storedPassword);
        if(password == storedPassword){
          agent.add(`La contraseña es correcta, ${username}`);
          agent.setFollowupEvent({ "name": "correctaccess", "parameters" : { "username": username, "password":password}});
        }else{
          agent.add(`Lo siento, la contraseña no es correcta`);
          agent.setFollowupEvent({ "name": "deniedaccess"});
        }  
      }
      return user;
    },function(error, isSuccess){
      console.log("Update average success: "+error);
    });
  }
  
  let intentMap = new Map();
  intentMap.set('GetUserPasswordIntent', handleGetPassword);
  intentMap.set('LoginIntroducePasswordIntent', handleLoginPassword);
  agent.handleRequest(intentMap);
});
