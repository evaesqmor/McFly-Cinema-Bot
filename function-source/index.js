// See https://github.com/dialogflow/dialogflow-fulfillment-nodejs
// for Dialogflow fulfillment library docs, samples, and to report issues
'use strict';
 
//Define Firebase

const functions = require('firebase-functions');
const {WebhookClient, Image} = require('dialogflow-fulfillment');
const {Card, Suggestion} = require('dialogflow-fulfillment');
const axios = require('axios');

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
  var tmdbKey = "5de10ffec3fea5b06d8713b047977f01";
  
   
  function handleUsernameRegistered(){
    const username= agent.parameters.username;
    let ref = database.ref("users");
    return ref.once("value").then((snapshot) =>{
      var passw =snapshot.child(`${username}/password`).val();
      if(passw !=null){
        agent.add(`El usuario ${username} ya existe. Prueba a registrarte con otro usuario`);
      }else {
        agent.add(`Adelante, introduce tu contraseña`);
        agent.setContext({ "name": "get_username_followup","lifespan":2,"parameters":{"username":username}});
      }
    });
  }

  function handleGetPassword(){
    const username= agent.parameters.username;
    const password = agent.parameters.password;
    agent.add(`Has sido registrado correctamente, ${username}`);
    generalRef.child(username).set({
      password: password,
    });
  }
  
  function handleLoginPassword(){
    const username= agent.parameters.username;
    const password = agent.parameters.password;
    let userRef = database.ref("users/"+username);
    /*Reading & writing from the database*/
    return userRef.transaction(user => {
      console.log(user);
      if(user!=null){
        let storedPassword = user.password;
        let alias = user.alias;
        if(password == storedPassword){
          agent.setFollowupEvent({ "name": "correctaccess", "parameters" : { "username": username, "password":password, "alias":alias}});
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
  
  function handleCorrectAccess(){
    const alias= agent.parameters.alias;
    if(alias == ""){
      agent.add(`¡Bienvenido!, ya que la primera vez que accedes, ¿cómo te gustaría que te llamase?`);
    }else{
        agent.add(`Buenas ${alias}, ¿qué te gustaría hacer?`);
    }
  }
  
  function handleUserAlias(){
    const alias= agent.parameters.alias;
    const username = agent.parameters.username;
	const password = agent.parameters.password;
    let userRef = database.ref("users/"+username);
    agent.setFollowupEvent({ "name": "correctaccess", "parameters" : { "username": username, "password":password, "alias":alias}});
    userRef.update({
      alias: alias
    });
  }
  
  function handleMediaSearch(){
    const medianame = agent.parameters.medianame;
    var arrayName = medianame.split(" ");
    var queryName = arrayName.join('-');
    agent.add(`Resultados para ${medianame}:`);
    return axios.get(`https://api.themoviedb.org/3/search/multi?api_key=${tmdbKey}&query=${queryName}&page=1&include_adult=false`)
      .then((result)=>{
      var count = 0;
      result.data.results.map((media) =>{
        if(count < 10){
        count++;
        var title = media.title==null?media.name:media.title;
        console.log("Titulo",title);
        var cardText = media.overview==null?"":media.overview;
        console.log("Resumen",cardText);
        var posterPath = "http://image.tmdb.org/t/p/w200/"+media.poster_path;
        agent.add(new Card({
           title: title,
           imageUrl: posterPath,
           text: cardText,
           buttonText: 'This is a button',
           buttonUrl: 'https://assistant.google.com/'
         }));
        }
      });
    });
  }
  
  let intentMap = new Map();
  intentMap.set('GetUserUsernameIntent', handleUsernameRegistered);
  intentMap.set('GetUserPasswordIntent', handleGetPassword);
  intentMap.set('LoginIntroducePasswordIntent', handleLoginPassword);
  intentMap.set('CorrectAccessIntent', handleCorrectAccess);
  intentMap.set('LoginFirstActionIntent', handleUserAlias);
  intentMap.set('SearchInfoIntent', handleMediaSearch);
  agent.handleRequest(intentMap);
});
