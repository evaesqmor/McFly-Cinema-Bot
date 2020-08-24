// See https://github.com/dialogflow/dialogflow-fulfillment-nodejs
// for Dialogflow fulfillment library docs, samples, and to report issues
'use strict';
 
//Define Firebase

const functions = require('firebase-functions');
const {Text, Card, WebhookClient, Image, Suggestion, Payload} = require('dialogflow-fulfillment');
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
  var imgPth = "http://image.tmdb.org/t/p/w500/";

  
  /*Registro, comprobar que el usuario no existe en la bdd*/
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

  /*Registro, guardar usuario en la bdd*/
  function handleGetPassword(){
    const username= agent.parameters.username;
    const password = agent.parameters.password;
    agent.add(`Has sido registrado correctamente, ${username}`);
    generalRef.child(username).set({
      password: password,
    });
  }
  
  /*Login, comprobación de la contraseña*/
  function handleLoginPassword(){
    const username= agent.parameters.username;
    const password = agent.parameters.password;
    let userRef = database.ref("users/"+username);
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
  
  /*Acceso por primera vez o introducción*/
  function handleCorrectAccess(){
    const alias= agent.parameters.alias;
    if(alias == ""){
      agent.add(`¡Bienvenido!, ya que la primera vez que accedes, ¿cómo te gustaría que te llamase?`);
    }else{
        agent.add(`Buenas ${alias}, ¿qué te gustaría hacer?`);
    }
  }
  
  /*Recordar el nombre del usuario*/
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
    return axios.get(`https://api.themoviedb.org/3/search/multi?api_key=${tmdbKey}&query=${queryName}&page=1&include_adult=false&language=es`)
      .then((result)=>{
      var count = 0;
      var searchResults = [];

      result.data.results.map((media) =>{
        if(count < 10){
        count++;
        var mediaType=media.media_type;
        agent.add(`Tipo: ${mediaType}`);
        var title, fullTitle, cardText, posterPath = "";
        
        if(mediaType=="person"){
          title =`${media.name}`;
          fullTitle = `${count}. ${media.name}`;
          cardText = "";
          posterPath = imgPth+media.profile_path;
          var countNotable = 0;
          media.known_for.map((notable) => {
            if(countNotable < 3){
              countNotable++;
              var notableName = notable.title==null?notable.name:notable.title;
              cardText = cardText+notableName+"\n";
              }
          });
         cardText = cardText!=""?"**Conocido por**:\n"+cardText:cardText;
        }
          
        if(mediaType=="tv"){
          title =`${media.name}`;
          fullTitle =`${count}. ${media.name}`;
          cardText = "Nota media: "+media.vote_average+"\n"+
            "Fecha de estreno: "+media.first_air_date+"\n"+
            media.overview;
          posterPath = imgPth+media.poster_path;
        }
        
        if(mediaType=="movie"){
          title = `${media.title}`;
          fullTitle = `${count}. ${media.title}`;
          cardText = "Nota media: "+media.vote_average+"\n"+
            "Fecha de estreno: "+media.release_date+"\n"+
            media.overview;
          posterPath = imgPth+media.poster_path;
        }

        agent.add(new Card({
           title: fullTitle,
           imageUrl: posterPath,
           text: cardText,
         }));
          
         searchResults.push(title);
         agent.add(new Suggestion(`${title} (${mediaType} : ${media.id})`));  
        }
      });
    });
  }
  
  function handleViewMediaDetails(){
    var mediaelement = agent.parameters.mediaelement;
    var mediatype = agent.parameters.mediatype;
    var mediaid = agent.parameters.mediaid;
    
    if(mediatype=="person"){
       return axios.get(`https://api.themoviedb.org/3/person/${mediaid}?api_key=${tmdbKey}&language=es`)
      .then((result)=>{
         var name = result.data.name;
         var cardText=
             "Ocupación: "+result.data.known_for_department+"\n"+
             "Fecha de nacimiento: "+result.data.birthday+"\n"+
             "Fecha de fallecimiento: "+result.data.deathday+"\n"+
             "Lugar de nacimiento: "+result.data.place_of_birth+"\n"+
             "Biografía: "+result.data.biography;
         var image= imgPth+result.data.profile_path;
         
         agent.add(new Card({
           title: name,
           imageUrl: image,
           text: cardText,
         }));
       });
    }
    
    if(mediatype=="tv"){
       return axios.get(`https://api.themoviedb.org/3/tv/${mediaid}?api_key=${tmdbKey}&language=es`)
      .then((result)=>{
         var name = result.data.name;
         var posterPath = imgPth+result.data.poster_path;
         var genres = "";
         var direction = "";
         var inProduction = result.data.in_production;
         
        //Géneros
        result.data.genres.map((genre) => {
          genres = genres+genre.name+"|";
        });
         
        //Dirección
        result.data.created_by.map((director)=>{
          direction=direction+director.name+"|";
        });
         
         var cardText = 
         "Puntuación media: "+result.data.vote_average+"\n"+
         "Dirigida por: "+direction+"\n"+
         "Próximo Episodio: "+result.data.next_episode_to_air+"\n"+
         "Total de episodios: "+result.data.number_of_episodes+"\n"+
         "Total de temporadas: "+result.data.number_of_seasons+"\n"+
         "Fecha de estreno: "+result.data.first_air_date+"\n"+
         "Estado actual: "+result.data.status+"\n"+
         "Fecha de fin: "+result.data.last_air_date+"\n"+
         "Idioma original: "+result.data.original_language+"\n"+
         "Géneros: "+genres+"\n"+    
         "Resumen: "+result.data.overview;
       
       	 agent.add(new Card({
           title: name,
           imageUrl: posterPath,
           text: cardText,
         }));	 
       });
    }
    
    if(mediatype=="movie"){
      return axios.get(`https://api.themoviedb.org/3/movie/${mediaid}?api_key=${tmdbKey}&language=es`)
      .then((result)=>{
        var name= result.data.title;
        var genres = "";
        
        //Géneros
        result.data.genres.map((genre) => {
          genres = genres+genre.name+"|";
        });

        var cardText=
           	"Tg: "+result.data.tagline+"\n"+
            "Puntuación media: "+result.data.vote_average+"\n"+
           	"Fecha de estreno: "+result.data.release_date+"\n"+
            "Idioma original: "+result.data.original_language+"\n"+
            "Estado: "+result.data.status+"\n"+
            "Presupuesto: "+result.data.budget+"\n"+
            "Recaudado: "+result.data.revenue+"\n"+
            "Géneros: "+genres+"\n"+
            "Resumen: "+result.data.overview+"\n";
        
        var posterPath = imgPth+result.data.poster_path;

        agent.add(new Card({
           title: name,
           imageUrl: posterPath,
           text: cardText,
         }));
      });
    }
  }
  
  let intentMap = new Map();
  intentMap.set('GetUserUsernameIntent', handleUsernameRegistered);
  intentMap.set('GetUserPasswordIntent', handleGetPassword);
  intentMap.set('LoginIntroducePasswordIntent', handleLoginPassword);
  intentMap.set('CorrectAccessIntent', handleCorrectAccess);
  intentMap.set('LoginFirstActionIntent', handleUserAlias);
  intentMap.set('SearchInfoIntent', handleMediaSearch);
  intentMap.set('ViewMediaDetails', handleViewMediaDetails);
  agent.handleRequest(intentMap);
});
