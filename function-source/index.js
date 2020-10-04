// See https://github.com/dialogflow/dialogflow-fulfillment-nodejs
// for Dialogflow fulfillment library docs, samples, and to report issues
'use strict';
 
//Define Firebase
const functions = require('firebase-functions');
const {Text, Card, WebhookClient, Image, Suggestion, Payload} = require('dialogflow-fulfillment');
const axios = require('axios');
const cheerio = require('cheerio');
const request = require('request');
const nodemailer = require('nodemailer');
const translate = require('translate');
const getAge = require('get-age');
const yts = require( 'yt-search' );
const ISO6391 = require('iso-639-1');
const date = require('date-and-time');
const d3 = require('d3-format');
const countries = require("i18n-iso-countries");
countries.registerLocale(require("i18n-iso-countries/langs/en.json"));
countries.registerLocale(require("i18n-iso-countries/langs/es.json"));
const cc = require('currency-codes');
const data = require('currency-codes/data');
const currency = require( 'country-to-currency' );
const stripe = require('stripe')('sk_test_51HWh0hKfScpaeE9Gpm75eNKgRKMPtY4o7szLdum0ywZmUJ01oXrYmtCzDVHWRqH7STZtSevYYPVUayLmgRfSVPBz005o1X0efw');
const screenshot = require('screenshot-desktop');

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
  var endpoint = "https://api.themoviedb.org/3";
  var abcPth = "https://www.abc.es/"; 
  var ticketsPth = "https://cine.entradas.com";
 
/************LOGIN & REGISTRATION************/
  /*Registering: Checking that it is a new user*/
  function handleUsernameRegistered(){
    const username= agent.parameters.username;
    let ref = database.ref("users");
    return ref.once("value").then((snapshot) =>{
      var passw =snapshot.child(`${username}/password`).val();
      if(passw !=null){
        agent.add(`El usuario ${username} ya existe. Prueba a introducir otro usuario`);
        agent.setContext({ "name": "not_registered_followup","lifespan":1});
      }else {
        agent.add(new Card({title: "Contraseña",text: "Adelante, introduce una contraseña"}));
        agent.setContext({ "name": "get_username_followup","lifespan":1,"parameters":{"username":username}});
      }
    });
  }

  /*Registering: Saving the new user in Firebase*/
  function handleGetPassword(){
    const username= agent.parameters.username;
    const password = agent.parameters.password;
    agent.add(`Has sido registrado correctamente, ${username}. ¿Te gustaría logearte?`);
    generalRef.child(username).set({
      password: password,
    });
  }
  
  /*Login: Checking correct password*/
  function handleLoginPassword(){
    const username= agent.parameters.username;
    const password = agent.parameters.password;
    let userRef = database.ref("users/"+username);
    return userRef.transaction(user => {
      console.log(user);
      if(user!=null){
        let storedPassword = user.password;
        let alias = user.alias;
        console.log("CONTRASEÑA: ", storedPassword);
        if(password == storedPassword){
          agent.setFollowupEvent({ "name": "correctaccess", "parameters" : { "username": username, "password":password, "alias":alias}});
        }else{
          agent.add(`La contraseña no es correcta. ¿Quieres volver a intentarlo?`);
          agent.setContext({ "name": "registered_followup","lifespan":1});  
        }
      }else{
        agent.add(`Lo siento, la contraseña o el usuario no son correctos. ¿Quieres volver a intentarlo?`);
        agent.setContext({ "name": "registered_followup","lifespan":1});  
      }
      return user;
    },function(error, isSuccess){
      console.log("Update average success: "+error);
    });
  }
  
  /*CorrectAcess actions*/
  function handleCorrectAccess(){
    const alias= agent.parameters.alias;
    const username = agent.parameters.username;
    const password = agent.parameters.password;
    console.log(""+alias);
    agent.add(`${alias}`);
    if(alias == ""){
      agent.setFollowupEvent({ "name": "askalias", "parameters" : { "username": username, "password":password, "alias":alias}});
    }else{
      agent.setFollowupEvent({ "name": "tasks", "parameters" : { "username": username, "password":password, "alias":alias}});
    }
  }
  
  /*Storing the user's alias*/
  function handleUserAlias(){
    const alias= agent.parameters.alias.name;
    const username = agent.parameters.username;
	const password = agent.parameters.password;    
    generalRef.child(username).update({
      alias: alias,
    });
  }
  
  /*Storing the user's email*/
  function handleUserEmail(){
    const alias= agent.parameters.alias.name;
    const username = agent.parameters.username;
	const password = agent.parameters.password;
    const email = agent.parameters.email;
    generalRef.child(username).update({
      email: email,
    });
    agent.setFollowupEvent({ "name": "tasks", "parameters" : { "username": username, "password":password, "alias":alias, "email":email}});
  }
  
  /*******SEARCHING CONTENTS*******/

  /*General Info Search: Movies, Shows and People. Displaying basic info*/
  function handleMediaSearch(){
    const medianame = agent.parameters.medianame;
    var auxname = medianame.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    var arrayName = auxname.split(" ");
    var queryName = arrayName.join('-');
    agent.add(new Card({title: "Resultados",text: `Para ${medianame}`}));
    return axios.get(`${endpoint}/search/multi?api_key=${tmdbKey}&query=${queryName}&page=1&include_adult=false&language=es`)
      .then((result)=>{
      if(result.data.results.length>0){
        var count = 0;
        result.data.results.map((media) =>{
          if(count < 5){
            count++;
            var type=media.media_type;
            var fullTitle, cardText = "";
            var releaseDate;
            var mediaid=media.id;
            var posterPath =type=="person"?imgPth+media.profile_path:imgPth+media.poster_path;
            var title = type=="movie"?media.title:media.name;
            var parsetitle = title.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
            var overview = media.overview==""?"":"Resumen: "+media.overview;
            var voteAverage=media.vote_average==0?"":"Nota media: "+media.vote_average;
            /*Person generic view*/
            if(type=="person"){
              var department = media.known_for_department;
              var gender = media.gender;
              var occupation = "";
              if(department=="Acting"){
                if(gender==1){occupation = "Actriz";}
                if(gender==2){occupation= "Actor";}
              }
              if(department=="Directing"){
                if(gender==1){occupation = "Directora";}
                if(gender==2){occupation= "Director"; }
              }
              if(department=="Production"){
                if(gender==1){occupation = "Productora";}
                if(gender==2){occupation= "Productor";}
              }
              fullTitle = `${count}. ${title} (${occupation})`;
              cardText = "";
              var countNotable = 0;
              media.known_for.map((notable) => {
                  var notableName = notable.title==null?notable.name:notable.title;
                  cardText = cardText+notableName+"\n";
              });
              cardText = cardText!=""?"**Conocido por** :\n"+cardText:cardText;
              agent.add(new Card({title: `${fullTitle}`,imageUrl: posterPath,text: `${cardText}`,buttonText: `Ver detalles`,
              buttonUrl: `${parsetitle} (${type} : ${mediaid})`}));
            }
            /*Tv Show generic view*/
            if(type=="tv"){
              fullTitle =`${count}. ${media.name} (Serie de televisión)`;
              releaseDate = media.first_air_date==null?"":"Fecha de estreno: "+media.first_air_date;
              cardText = voteAverage+"\n"+releaseDate+"\n"+overview;
              agent.add(`${parsetitle} (${type} : ${mediaid})`);
              agent.add(new Card({title: `${fullTitle}`,imageUrl: posterPath,text: `${cardText}`,buttonText: `Ver detalles`,
              buttonUrl: `${parsetitle} (${type} : ${mediaid})`}));
            }
            /*Movie generic view*/
            if(type=="movie"){
              fullTitle = `${count}. ${media.title} (Película)`;
              releaseDate = media.release_date==null?"":"Fecha de estreno: "+media.release_date;
              cardText = voteAverage+"\n"+releaseDate+"\n"+overview;
              agent.add(`${parsetitle} (${type} : ${mediaid})`);
              agent.add(new Card({title: `${fullTitle}`,imageUrl: posterPath,text: `${cardText}`,buttonText: `Ver detalles`,
              buttonUrl: `${parsetitle} (${type} : ${mediaid})`}));
            } 
          }
        });
      }else{agent.add(`No se han encontrado resultados para la búsqueda de ${medianame}. Vuelve a intentarlo`);}
    });
  }
  
  /*Display details: Visualize the details of a movie, show or person*/
  function handleViewMediaDetails(){
    var mediaelement = agent.parameters.mediaelement;
    var type = agent.parameters.mediatype;
    var mediaid = agent.parameters.mediaid;
    /*Person details*/
    if(type=="person"){
      return axios.get(`${endpoint}/person/${mediaid}?api_key=${tmdbKey}&language=es`)
      .then((result)=>{
         if(result!=null){
         var person = result.data;
         var personname = person.name;
         var department = person.known_for_department;
         var knownDepartment = "Ocupación: ";
         if(department=="Acting"){knownDepartment = knownDepartment+"Actuación \n";}
         if(department=="Directing"){knownDepartment = knownDepartment+"Dirección \n";}
         if(department=="Production"){knownDepartment = knownDepartment+"Producción \n"; }
         var birthday ="Fecha de nacimiento: "+person.birthday+" ("+getAge(person.birthday)+" años)"+"\n";
         var deathday = person.deathday==null?"":"Fecha de fallecimiento: "+person.deathday+"\n";
         var placeOfBirth = "Lugar de nacimiento: "+person.place_of_birth+"\n";
         var biography = person.biography==""?"":"Biografía: "+person.biography+"\n";
         var personalWeb = person.homepage==null?"":"Página web: "+person.homepage+"\n";
         var cardText=knownDepartment+birthday+deathday+placeOfBirth+biography+personalWeb;
         var image= imgPth+person.profile_path;
         agent.add(new Card({title: "Detalles" ,text: `Mostrando detalles para ${personname}`}));
         agent.add(new Card({title: personname,imageUrl: image,text: cardText}));
         agent.add(new Card({title: `Películas de ${personname}`,buttonText:`Mostrar películas`,text:`Ver detalles de algunas de las películas más conocidas de ${personname}`,buttonUrl:`Peliculas famosas de ${personname}`}));
       	 agent.add(new Card({title: `Series de ${personname}`,buttonText:`Mostrar series`,text:`Ver detalles de algunas de las series más conocidas en las que aparece ${personname}`,buttonUrl:`series de ${personname}`}));
       	 agent.add(new Card({title: `Fotos de ${personname}`,buttonText:`Ver fotos`,text:`Mostrar algunas imágenes de ${personname}`,buttonUrl:`Fotos de ${personname}`}));
         }else{agent.add(`No se han encontrado resultados para la búsqueda de ${mediaelement}. Vuelve a intentarlo`);}
       });  
    }
    /*Show Details*/
    if(type=="tv"){
       return axios.get(`${endpoint}/tv/${mediaid}?api_key=${tmdbKey}&language=es`)
      .then((result)=>{
         if(result!=null){
         var show = result.data;
         var name = show.name;
         var voteAverage = show.vote_average==0?"":"Puntuación media: "+show.vote_average+"\n";
         var nextEpisode = show.next_episode_to_air==null?"":"Próximo episodio: "+show.next_episode_to_air+"\n";
         var totalEpisodes = show.number_of_episodes==0?"":"Total de episodios: "+show.number_of_episodes+"\n";
         var totalSeasons = show.number_of_seasons==0?"":"Total de temporadas: "+show.number_of_seasons+"\n";
         var airDate = show.first_air_date==null?"":"Fecha de estreno: "+show.first_air_date+"\n";
         var status;
         if(show.status=="Ended"){status="Estado: Finalizada \n";}
         if(show.status=="Returning Series"){status="Estado: Renovada \n";}
         if(show.status=="Canceled"){status="Estado: Cancelada \n";}
         var lastAirDate = show.last_air_date==null?"":"Última fecha de emisión: "+show.last_air_date+"\n";
         var originaltitle = (show.original_name==name || show.original_name==null)?"":"Título original: "+show.original_name+"\n";
	 	 var originallanguage = show.original_language;
     	 var lang = ISO6391.getName(originallanguage);
         var langtranslation;
         if(lang=="English"){
            langtranslation="inglés";
          }else{
            if(lang=="French"){
              langtranslation="francés";
            }else{
              if(lang=="Spanish"){
                langtranslation="español";
              }else{
                if(lang=="Italian"){
                  langtranslation="italiano";
                }else{
                  if(lang=="German"){
                    langtranslation="alemán";
                  }else{
                    if(lang=="Chinese"){
                      langtranslation="chino";
                    }else{
                      if(lang=="Korean"){
                        langtranslation="coreano";
                      }else{
                        if(lang=="Japanese"){
                          langtranslation="japonés";
                        }else{
                          langtranslation=lang;
                        }
                      }
                    }
                  }
                } 
              }
            }
          }
         originallanguage = "Idioma original: "+langtranslation+"\n";
         var overview = show.overview==""?"":"Resumen: "+show.overview+"\n";
         var inProduction = show.in_production;
         var genres =show.genres.length>0?"Géneros: \n":"";
         show.genres.map((genre) => {genres = genres+genre.name+"\n";});
         var direction = show.created_by.length>0?"Dirección: \n":"";
         show.created_by.map((director)=>{direction=direction+director.name+"\n";});
         var posterPath = imgPth+show.poster_path;
         var homepage = show.homepage==""?"":"Página oficial: "+show.homepage+"\n";
         var country =show.origin_country.length>0?"País de origen: "+countries.getName(show.origin_country[0], "es")+"\n":"";   
         var cardText = voteAverage+originaltitle+nextEpisode+totalEpisodes+
         totalSeasons+airDate+status+lastAirDate+originallanguage+country+overview+direction+genres;
       	 agent.add(new Card({title: "Detalles" ,text: `Mostrando detalles para ${name}`}));
         agent.add(new Card({title: name,imageUrl: posterPath,text: cardText,buttonText: `Añadir a mis listas`,buttonUrl: `Añadir `}));
         agent.add(new Card({title: `Temporadas de ${name}`,buttonText:`Temporadas`,text:`Detalles de las temporadas de ${name}`,buttonUrl:`Temporadas`}));
		 agent.add(new Card({title: `Trailer de ${name}`,buttonText:`Ver el trailer`,text:`Mostrar el trailer de la serie ${name}`,buttonUrl:`trailer de ${name}`}));
         agent.add(new Card({title: `¿Dónde ver ${name}?`,text: `Plataformas donde puedes ver la serie ${name}`,buttonText: `Buscar plataformas`,buttonUrl: `Ver ${name})`}));
         agent.add(new Card({title: `Reparto y equipo de ${name}`,text: `Ver imágenes del equipo de la serie ${name}`,buttonText: `Ver reparto`,buttonUrl: `Reparto de ${name})`}));
       	 agent.add(new Card({title: `Fotos de ${name}`,buttonText:`Ver fotos`,text:`Mostrar algunas imágenes de la serie ${name}`,buttonUrl:`Fotos de ${name}`}));
         agent.add(new Card({title: `Reseñas de ${name}`,buttonText:`Ver Reseñas`,text:`Mostrar algunas reseñas de la serie ${name}`,buttonUrl:`Reseñas de ${name}`}));
         agent.add(new Card({title: `Similares a ${name}`,text: `Contenidos similares a la serie ${name}`, buttonText: `Ver similares`,buttonUrl: `Recomendaciones ${name}`}));
         }else{agent.add(`No se han encontrado resultados para la búsqueda de ${mediaelement}. Vuelve a intentarlo`);}
       });
    }
    /*Movie Details*/
    if(type=="movie"){
      return axios.get(`${endpoint}/movie/${mediaid}?api_key=${tmdbKey}&language=es`)
      .then((result)=>{
        if(result!=null){
        var movie = result.data;
        var name= movie.title;
        var tagline= movie.tagline+"\n";
        var voteAverage = movie.vote_average==0?"":"Puntuación media: "+movie.vote_average+"\n";
        var releaseDate = movie.release_date==null?"":"Fecha de estreno: "+movie.release_date+"\n";
        var originaltitle = (movie.original_title==name || movie.original_title==null)?"":"Título original: "+movie.original_title+"\n";
        var originallanguage = movie.original_language;
     	var lang = ISO6391.getName(originallanguage);
        var langtranslation;
         if(lang=="English"){
            langtranslation="inglés";
          }else{
            if(lang=="French"){
              langtranslation="francés";
            }else{
              if(lang=="Spanish"){
                langtranslation="español";
              }else{
                if(lang=="Italian"){
                  langtranslation="italiano";
                }else{
                  if(lang=="German"){
                    langtranslation="alemán";
                  }else{
                    if(lang=="Chinese"){
                      langtranslation="chino";
                    }else{
                      if(lang=="Korean"){
                        langtranslation="coreano";
                      }else{
                        if(lang=="Japanese"){
                          langtranslation="japonés";
                        }else{
                          langtranslation=lang;
                        }
                      }
                    }
                  }
                } 
              }
            }
          } 
        originallanguage = "Idioma original: "+langtranslation+"\n";
        var status;
        if(movie.status=="Released"){status="Estado: Estrenada \n";}
        if(movie.status=="Post Production"){status="Estado: Post-Producción \n";}
        if(movie.status=="In Production"){status="Estado: En Producción \n";}
        if(movie.status=="Planned"){status="Estado: Planeada \n";}
        var runtime = movie.runtime==0?"":"Duración: "+movie.runtime+" minutos \n";
        var budget= movie.budget==0?"":"Presupuesto: "+d3.format("~s")(movie.budget)+"\n";
        var revenue = movie.revenue==0?"":"Recaudado: "+d3.format("~s")(movie.revenue)+"\n";
        var homepage = movie.homepage==""?"":"Página oficial: "+movie.homepage+"\n";
        var overview = movie.overview==""?"":"Resumen: "+movie.overview+"\n";
        var genres = movie.genres.length>0?"Géneros: \n":"";
        movie.genres.map((genre) => {genres = genres+genre.name+"\n";});
        var country =movie.production_countries.length>0?"País de origen: "+countries.getName(movie.production_countries[0].iso_3166_1, "es")+"\n":"";   
        var cardText = tagline+voteAverage+releaseDate+originaltitle+country+originallanguage+
        status+budget+revenue+runtime+genres+overview;
        var posterPath = imgPth+movie.poster_path;
        agent.add(new Card({title: "Detalles" ,text: `Mostrando detalles para ${name}`}));
        agent.add(new Card({title: name,imageUrl: posterPath,text: cardText,buttonText: `Añadir a mis listas`,buttonUrl: `Añadir `}));
        agent.add(new Card({title: `Trailer de ${name}`,buttonText:`Ver trailer`,text:`Mostrar el trailer de la pelicula ${name}`,buttonUrl:`trailer de ${name}`}));
		agent.add(new Card({title: `¿Dónde ver ${name}?`,text: `Plataformas donde puedes visualizar la película ${name}`,buttonText: `Buscar plataformas`,buttonUrl: `Ver ${name})`}));
        agent.add(new Card({title: `Reparto y equipo de ${name}`,text: `Ver imágenes del equipo de la película ${name}`,buttonText: `Ver reparto`,buttonUrl: `Reparto de ${name})`}));
        agent.add(new Card({title: `Fotos de ${name}`,buttonText:`Ver fotos`,text:`Mostrar algunas imágenes de la película ${name}`,buttonUrl:`Fotos de ${name}`}));
        agent.add(new Card({title: `Reseñas de ${name}`,buttonText:`Ver Reseñas`,text:`Mostrar algunas reseñas de la película ${name}`,buttonUrl:`Reseñas de ${name}`}));
        agent.add(new Card({title: `Similares a ${name}`,text: `Contenidos similares a la película ${name}`, buttonText: `Ver similares`,buttonUrl: `Recomendaciones ${name}`}));
       	}else{agent.add(`No se han encontrado resultados para la búsqueda de ${mediaelement}. Vuelve a intentarlo`);}
      });
    }
  }
  
  /************Content Lists************/
  /*Movies now on cinemas*/
  function handleNowShowing(){
    var mediatype = agent.parameters.mediatype;
    var location = agent.parameters.location;
    agent.add(new Card({title: "Resultados" ,text: `Mostrando películas ahora en el cinema: `}));
    return axios.get(`${endpoint}/movie/now_playing?api_key=${tmdbKey}&language=es&page=1`)
        .then((result)=>{
      	if(result.data.results.length>0){
      	var count = 0;
        result.data.results.map((movie)=>{
          if(count<8){
          count++;
          var name= movie.title;
          var mediaid = movie.id;
          var voteAverage=movie.vote_average==0?"":"Puntuación media: "+movie.vote_average+"\n";
          var releaseDate=movie.release_date==null?"":"Fecha de estreno: "+movie.release_date+"\n";
          var overview = movie.overview==""?"":"Resumen: "+movie.overview;
          var cardText=voteAverage+releaseDate+overview;
          var posterPath = imgPth+movie.poster_path;
          agent.add(new Card({title: name,imageUrl: posterPath,text: cardText, buttonText: `Ver detalles`,
              buttonUrl: `${name} (movie : ${mediaid})`}));
          agent.add(new Card({title: `Añadir a favoritos`,text: `Añádela a tu lista de favoritos`, buttonText: `Añadir a mis listas`,buttonUrl: `Añadir `}));
          }
        });
        }else{
          agent.add(new Card({title: "Sin resultados" , text: `No se han encontrado películas actualmente en cines. Inténtalo en otro momento`}));
        }
      }); 
  }
  
  /*Most Popular Movies*/
  function handleMostPopularMovies(){
     return axios.get(`${endpoint}/movie/popular?api_key=${tmdbKey}&language=es&page=1`)
        .then((result)=>{
       		if(result.data.results.length>0){
            agent.add(new Card({title: "Resultados" ,text: `Mostrando películas más populares: `}));
       		var count = 0;
       		result.data.results.map((movie)=>{
              if(count<8){
                count++;
                var name= movie.title;
                var mediaid = movie.id;
                var voteAverage=movie.vote_average==0?"":"Puntuación media: "+movie.vote_average+"\n";
                var releaseDate=movie.release_date==null?"":"Fecha de estreno: "+movie.release_date+"\n";
                var overview = movie.overview==""?"":"Resumen: "+movie.overview;
                var cardText=voteAverage+releaseDate+overview;
                var posterPath = imgPth+movie.poster_path;
                agent.add(new Card({title: name,imageUrl: posterPath,text: cardText, buttonText: `Ver detalles`,
                    buttonUrl: `${name} (movie : ${mediaid})`}));
                agent.add(new Card({title: `Añadir a favoritos`,text: `Añádela a tu lista de favoritos`, buttonText: `Añadir a mis listas`,buttonUrl: `Añadir `}));
              }
           });
         }else{
			agent.add(new Card({title: "Sin resultados" , text: `Ahora no hay películas populares. Vuelve a intentarlo en otro momento.`}));
         }
     });
  }

  /*Search: Most Popular Shows*/
  function handleSearchMostPopularTvShows(){
    return axios.get(`${endpoint}/tv/popular?api_key=${tmdbKey}&language=es&page=1`)
       .then((result)=>{
        if(result.data.results.length>0){
          agent.add(new Card({title: "Resultados" ,text: `Mostrando series más populares: `}));
          var count = 0;
          result.data.results.map((tv)=>{
             if(count<6){
               count++;
               var name= tv.name;
               var mediaid=tv.id;
               var voteAverage = tv.vote_average == 0?"":"Puntuación media: "+tv.vote_average+"\n";
               var releaseDate = "Fecha de estreno: "+tv.first_air_date+"\n";
               var overview = tv.overview==""?"":"Resumen: \n"+tv.overview;
               var posterPath=imgPth+tv.poster_path;
               var cardText =voteAverage+releaseDate+overview;
               agent.add(new Card({title: name,imageUrl: posterPath,text: cardText, buttonText: `Ver detalles`,
               buttonUrl: `${name} (tv : ${mediaid})`}));
               agent.add(new Card({title: `Añadir a favoritos`,text: `Añádela a tu lista de favoritos`, buttonText: `Añadir a mis listas`,buttonUrl: `Añadir `}));
             }
          });
      }else{agent.add(new Card({title: "Sin resultados" , text: `No se han encontrado series más populares. Vuelve a intentarlo`}));}
    });
 }
 
  /*Top Rated Movies*/
  function handleTopRatedMovies(){
     return axios.get(`${endpoint}/movie/top_rated?api_key=${tmdbKey}&language=es&page=1`)
        .then((result)=>{
       		if(result.data.results.length>0){
            agent.add(new Card({title: "Resultados" ,text: `Mostrando películas mejor valoradas: `}));
       		var count = 0;
       		result.data.results.map((movie)=>{
              if(count<8){
                count++;
                var name= movie.title;
                var mediaid = movie.id;
                var voteAverage=movie.vote_average==0?"":"Puntuación media: "+movie.vote_average+"\n";
                var releaseDate=movie.release_date==null?"":"Fecha de estreno: "+movie.release_date+"\n";
                var overview = movie.overview==""?"":"Resumen: "+movie.overview;
                var cardText=voteAverage+releaseDate+overview;
                var posterPath = imgPth+movie.poster_path;
                agent.add(new Card({title: name,imageUrl: posterPath,text: cardText, buttonText: `Ver detalles`,
                    buttonUrl: `${name} (movie : ${mediaid})`}));
                agent.add(new Card({title: `Añadir a favoritos`,text: `Añádela a tu lista de favoritos`, buttonText: `Añadir a mis listas`,buttonUrl: `Añadir `}));
              }
            });
         }else{
            agent.add(new Card({title: "Sin resultados" , text: `Ahora mismo no hay películas mejor valoradas. Vuelve a intentarlo en otro momento`}));
         }
     });
  }

  /*Searching Top Rated Shows*/
  function handleSearchTopRatedTvShows(){
    return axios.get(`${endpoint}/tv/top_rated?api_key=${tmdbKey}&language=es&page=1`)
        .then((result)=>{
      	if(result.data.results.length>0){
          agent.add(new Card({title: "Resultados" ,text: `Mostrando series mejor valoradas: `}));
            var count = 0;
       		result.data.results.map((show)=>{
              if(count<6){
              count++;
              var mediaid = show.id;
              var name= show.name;
              var voteAverage = show.vote_average==0?"":"Puntuación media: "+show.vote_average+"\n";
              var releaseDate = show.first_air_date==null?"":"Fecha de estreno: "+show.first_air_date+"\n";
              var overview = show.overview==""?"":"Resumen: "+show.overview;
              var cardText=voteAverage+releaseDate+overview;
              var posterPath = show.poster_path==null?"":imgPth+show.poster_path;
              agent.add(new Card({title: name,imageUrl: posterPath,text: cardText,
              buttonText: `Ver detalles`, buttonUrl: `${name} (tv : ${mediaid})`}));
              agent.add(new Card({title: `Añadir a favoritos`,text: `Añádela a tu lista de favoritos`, 
              buttonText: `Añadir a mis listas`, buttonUrl: `Añadir `}));
              }
           });
        }else{agent.add(new Card({title: "Sin resultados" , text: `Ahora mismo no hay series mejor valoradas. Vuelve a intentarlo en otro momento`}));
	   }
    });
  }

/**********SPECIFIC INFO LISTS*********/

/*Media Cast*/
function handleMediaCast(){
  var medianame =agent.parameters.medianame;
  var auxname = medianame.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  var query = agent.query;
  var arrayName = auxname.split(" ");
  var queryName = arrayName.join('-');
  return axios.get(`${endpoint}/search/multi?api_key=${tmdbKey}&query=${queryName}&page=1&include_adult=false&language=es`)
    .then((result)=>{
      if(result.data.results.length>0){
        var element = result.data.results[0];
        var type=element.media_type;
        var translation = type=="tv"?"serie":"película";
        var elementname = type=="tv"?element.name:element.title;
        var mediaid = element.id;
        var posterPath=imgPth+element.backdrop_path;
        if(type=="tv"||type=="movie"){
         return axios.get(`${endpoint}/${type}/${mediaid}/credits?api_key=${tmdbKey}&language=es`)
        .then((credits)=>{
           if(credits.data.cast.length>0){
           agent.add(new Card({title:`Reparto de ${elementname}`,imageUrl:posterPath,text: `Mostrando el reparto de la ${translation} ${elementname} ` }));
             var count = 0;
             credits.data.cast.map((credit) =>{
               if(count<6){
                 count++;
                 var personname=credit.name;
                 var character = credit.character;
                 var personid = credit.id;
                 var personphoto = credit.profile_path==null?"":imgPth+credit.profile_path;
                 agent.add(new Card({title: `${personname}`,imageUrl: personphoto,text: `${personname} interpreta a ${character}`,
                 buttonText:`Ver Detalles`, buttonUrl: `${personname} (person : ${personid})` }));
               }
             });
             agent.add(new Card({title: `Dirección de ${elementname}`,text:`Directores de la ${translation} ${elementname}`,
             buttonText:`Ver directores`,buttonUrl:`directores de ${elementname}`}));
             agent.add(new Card({title: `Detalles`,text: `Ver los detalles de ${elementname}`,buttonText: `Ver detalles`,
             buttonUrl: `${elementname} (${type} : ${mediaid})`}));
           }else{agent.add(new Card({title:`Reparto de ${elementname}`,imageUrl:posterPath,text:`El reparto de ${elementname} no está registrado.`}));}
         }); 
        }else{agent.add(new Card({title: "Busca una serie o película" , text: `Puedes buscar el reparto de una serie o película`}));
       }
      }else{agent.add(new Card({title: "Sin resultados" , text: `No se han encontrado resultados para ${medianame}. Vuelve a intentarlo`}));
   }
  });
  }

 /*Media Directors*/
 function handleSearchMediaDirectors(){
  var medianame =agent.parameters.medianame;
  var auxname = medianame.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  var arrayName = auxname.split(" ");
  var queryName = arrayName.join('-');
  return axios.get(`${endpoint}/search/multi?api_key=${tmdbKey}&query=${queryName}&page=1&include_adult=false&language=es`)
  .then((result)=>{
      if(result.data.results.length>0){
        var element = result.data.results[0];
        var id = element.id;
        var type= element.media_type;
        var name = type=="movie"?element.title:element.name;
        var posterPath = element.backdrop_path==null?"":imgPth+element.backdrop_path;
        if(type=="tv"||type=="movie"){
        return axios.get(`${endpoint}/${type}/${id}/credits?api_key=${tmdbKey}&language=es`)
        .then((credits)=>{
            if(credits.data.crew.length>0){
              var cardText = "";
              var creditname = type=="tv"?credits.name:credits.title;
              var countdirectors = 0;
              credits.data.crew.map((credit)=>{
                if(credit.job=="Director"||credit.job=="Executive Producer"){
                  countdirectors++;
                  cardText=cardText+""+credit.name+" ~ ";
                }
              });
              if(countdirectors>0){
                agent.add(new Card({title: "Directores" ,imageUrl: posterPath, text: `Directores de ${name}: ${cardText}`,
                buttonText:`Ver detalles de ${name}`,buttonUrl:`${name} (${type} : ${id})`}));
              }else{agent.add(`No se han podido encontrar directores para ${name}`);}
            }else{agent.add(`No se han podido encontrar directores para ${name}`);}
          });
        }else{agent.add(new Card({title:`Directores`,text:`Prueba a buscar directores para una película o una serie.`}));}
      }else{
        agent.add(new Card({title: "Sin resultados" , text: `No se han encontrado resultados para ${medianame}. Vuelve a intentarlo`}));
      }
  });
}

/*Media networks*/
function handleSearchNetworks(){
 var medianame =agent.parameters.medianame;
 var auxname = medianame.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
 var arrayName = auxname.split(" ");
 var queryName = arrayName.join('-');
 return axios.get(`${endpoint}/search/multi?api_key=${tmdbKey}&query=${queryName}&page=1&include_adult=false&language=es`)
   .then((result)=>{
   if(result.data.results.length>0){
     var element = result.data.results[0];
     var id = element.id;
     var type = element.media_type;
     var title = type=="tv"?element.name:element.title;
     var posterPath = element.backdrop_path==null?"":imgPth+element.backdrop_path;
   return axios.get(`https://www.themoviedb.org/${type}/${id}-${queryName}/watch?language=es`)
   .then((response)=>{
   const $ = cheerio.load(response.data);
   var providers = $('.right_column').children('div.ott_provider')
   .first().find('ul.providers').children('.ott_filter_best_price');
   if(providers.length>0){
     agent.add(new Card({title:`¿Dónde ver ${title}?`,imageUrl:posterPath ,text:`Puedes ver ${title} en las siguientes plataformas:`}));
     var count = 0;
     providers.each((index,element)=>{
     var link = $(element).find('a');
     var linkReference = link.attr('href');
     var linkTitle = link.attr('title');
     var image = link.find('img').attr('src');
     var arrayTitle =linkTitle.split(" ");
     var length = arrayTitle.length;
     var platform= arrayTitle[length-2]=="en"?arrayTitle[length-1]:arrayTitle.slice(length-2,length).join(" ");
     //if(platform=="Netflix"||platform=="Disney Plus"||platform=="Prime Video"||platform=="HBO"){
     agent.add(new Card({title: `${platform}` ,imageUrl:linkReference, text: ``,buttonText: `Ver en ${platform}`,
      buttonUrl: linkReference}));
       count++;
     //}
      agent.add(new Card({title: `Detalles`,text: `Volver a los detalles de ${title}`,buttonText: `Ver detalles`,
              buttonUrl: `${title} (${type} : ${id})`}));
   });
     if(count==0){agent.add(new Card({title: "Sin resultados" , text: `No hay plataformas disponibles para visualizar ${medianame}`}));}
   }else{agent.add(new Card({title: "Sin resultados" , text: `No hay plataformas disponibles para visualizar ${medianame}`}));}
 });
   }else{agent.add(new Card({title: "Sin resultados" , text: `No se han encontrado resultados para ${medianame}. Vuelve a intentarlo`}));}
 });
}

/*Searching similar media*/
function handleSearchSimilarMedia(){
  var medianame =agent.parameters.medianame;
  var auxname = medianame.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  var arrayName = auxname.split(" ");
  var queryName = arrayName.join('-');
  return axios.get(`${endpoint}/search/multi?api_key=${tmdbKey}&query=${queryName}&page=1&include_adult=false&language=es`)
  .then((result)=>{
     if(result.data.results.length>0){
       var element = result.data.results[0];
       var elementid = element.id;
       var elementName = element.name;
       var type = element.media_type;
       var translation = type=="tv"?"serie":"película";
       var elementname = type =="tv"?element.name:element.title;
       var backdropPath = imgPth+element.backdrop_path;
       return axios.get(`${endpoint}/${type}/${elementid}/similar?api_key=${tmdbKey}&language=es&page=1`)
        .then((media)=>{
           if(media.data.results.length>0){
             agent.add(new Card({title: "Similares a "+elementname,imageUrl: backdropPath, text:`Resultados:`}));
             var count = 0;
             media.data.results.map((element)=>{
             if(count<4){
               count++;
              var title = type=="tv"?element.name:element.title;
              var mid = element.id;
              var posterPath = imgPth+element.poster_path;
              var overview = element.overview==""?"":"Resumen:\n"+element.overview;
              var releasedate = type=="tv"?element.first_air_date:element.release_date;
              var cardText="Fecha de estreno: "+releasedate+"\n"+overview;
              agent.add(new Card({title: title+" ("+translation+")",imageUrl: posterPath, text:cardText,buttonText:`Ver Detalles`, buttonUrl: `${title} (${type} : ${mid})`}));
              agent.add(new Card({title: `Añadir a favoritos`,text: `Añádela a tu lista de favoritos`, buttonText: `Añadir a mis listas`,buttonUrl: `Añadir `}));
              agent.add(new Card({title: `Detalles`,text: `Volver a los detalles de ${elementName}`,buttonText: `Ver detalles`,
            	buttonUrl: `${elementName} (${type} : ${elementid})`}));
             }
            });
           }else{agent.add(new Card({title: "Sin resultados" , text: `No se han encontrado resultados para ${medianame}. Vuelve a intentarlo`}));}
       });
     }else{agent.add(new Card({title: "Sin resultados" , text: `No se han encontrado resultados para ${medianame}. Vuelve a intentarlo`}));}
  });
}

 /*Popular movies of actor*/
 function handleSearchPersonPopularMovies(){
  var medianame =agent.parameters.medianame;
  var auxname = medianame.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  var arrayName =auxname.split(" ");
  var queryName = arrayName.join('-');
  return axios.get(`${endpoint}/search/person?api_key=${tmdbKey}&query=${queryName}&language=es&page=1&include_adult=true`)
  .then((result)=>{
    if(result.data.results.length>0){
      var element = result.data.results[0];
      var personId = element.id;
      var personName = element.name;
      var posterPath = imgPth+element.profile_path;
      var department = element.known_for_department;
      var gender = element.gender;
      return axios.get(`${endpoint}/person/${personId}/movie_credits?api_key=${tmdbKey}&language=es&sort_by=popularity.desc`)
      .then((credits)=>{
        if(credits.data.cast.length>0){
          agent.add(new Card({title: `Películas de ${personName}`,imageUrl: posterPath,text: `Estas son algunas películas de ${personName}`}));
          var count = 0;
          credits.data.cast.map((movie)=>{
          if(count<6){
            count++;
            var name = movie.title;
            var movieid = movie.id;
            var posterPath = imgPth+movie.poster_path;
            var character = movie.character==""?"":personName+" interpreta a "+movie.character+"\n";
            var voteAverage = movie.vote_average==0?"":"Puntuación media: "+movie.vote_average+"\n";
            var releaseDate = "Fecha de estreno: "+movie.release_date+"\n";
            var overview = movie.overview==""?"":"Resumen: "+movie.overview;
            var cardText=character+voteAverage+releaseDate+overview;
            agent.add(new Card({title: name,imageUrl: posterPath,text: cardText,
            buttonText:`Ver Detalles`, buttonUrl: `${name} (movie : ${movieid})`}));
            agent.add(new Card({title: `Añadir a favoritos`,text: `Añádela a tu lista de favoritos`, buttonText: `Añadir a mis listas`,buttonUrl: `Añadir `}));
           	agent.add(new Card({title: `Detalles`,text: `Volver a los detalles de ${personName}`,buttonText: `Ver detalles`,
            buttonUrl: `${auxname} (person : ${personId})`}));
          }
        });
       }else{
         if(credits.data.crew.length>0){
           credits.data.crew.map((crew)=>{
            var name = crew.title;
            var movieid = crew.id;
            var posterPath = imgPth+crew.poster_path;
            var job = crew.job;
             var jobTranslation;
               if(job=="Director"){
                 if(gender==1){jobTranslation="directora";}
                 if(gender==2){jobTranslation="director";}
               }
               if(job=="Executive Producer"){
                 if(gender==1){jobTranslation="productora ejecutiva";}
                 if(gender==2){jobTranslation="productor ejecutivo";}
               }
               if(job=="Producer"){
                 if(gender==1){jobTranslation="productora";}
                 if(gender==2){jobTranslation="productor";}
               }
               if(job=="Writer"||job=="Screenplay"||job=="Teleplay"){
                 jobTranslation="guionista";
               }
            var voteAverage = crew.vote_average==0?"":"Puntuación media: "+crew.vote_average+"\n";
            var releaseDate = "Fecha de estreno: "+crew.release_date+"\n";
            var overview = crew.overview==""?"":"Resumen: "+crew.overview;
            var cardText=personName+" es "+jobTranslation+" en "+name+"\n"+voteAverage+releaseDate+overview;
            agent.add(new Card({title: name,imageUrl: posterPath,text: cardText,
            buttonText:`Ver Detalles`, buttonUrl: `${name} (movie : ${movieid})`}));
            agent.add(new Card({title: `Añadir a favoritos`,text: `Añádela a tu lista de favoritos`, buttonText: `Añadir a mis listas`,buttonUrl: `Añadir `}));
           });
         }else{
           agent.add(new Card({title: "Sin resultados" , text: `No se han encontrado resultados para ${medianame}. Vuelve a intentarlo`}));
         }
       }
     });
    }else{agent.add(new Card({title: "Sin resultados" , text: `No se han encontrado resultados para ${medianame}. Vuelve a intentarlo`}));}
});
}

/*Popular shows of actor*/
function handleSearchPersonPopularTvShows(){
  var medianame =agent.parameters.medianame;
  var auxname = medianame.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  var arrayName = auxname.split(" ");
  var queryName = arrayName.join('-');
  return axios.get(`${endpoint}/search/person?api_key=${tmdbKey}&query=${queryName}&language=es&page=1&include_adult=true`)
  .then((result)=>{
    if(result.data.results.length>0){
      var element = result.data.results[0];
      var personId = element.id;
      var personName = element.name;
      var posterPath = imgPth+element.profile_path; 
      var gender = element.gender;
      return axios.get(`${endpoint}/person/${personId}/tv_credits?api_key=${tmdbKey}&language=es&sort_by=popularity.desc`)
      .then((credits)=>{
        if(credits.data.cast.length>0){
          agent.add(new Card({title: `Series de ${personName}`,imageUrl: posterPath,text: `Algunas series famosas de ${personName} son:`}));
          var count = 0;
          credits.data.cast.map((serie)=>{
          if(count<6){
            count++;
            var name = serie.name;
            var serieid =serie.id;
            var posterPath = imgPth+serie.poster_path;
            var character = serie.character==""?"":personName+" interpreta a "+serie.character+"\n";
            character = serie.character.trim()=="Herself"?"Como ella misma":personName+" interpreta a "+serie.character+"\n";
            character = serie.character.trim()=="Himself"?"Como él mismo":personName+" interpreta a "+serie.character+"\n";
            var voteAverage = serie.vote_average==0?"":"Puntuación media: "+serie.vote_average+"\n";
            var releaseDate = "Fecha de estreno: "+serie.first_air_date+"\n";
            var episodes = serie.episode_count==0?"":"Aparece en "+serie.episode_count+" episodios \n";
            var overview = serie.overview==""?"":"Resumen: "+serie.overview;
            var cardText=character+voteAverage+releaseDate+episodes+overview;
            agent.add(new Card({title: name,imageUrl: posterPath,text: cardText,
            buttonText:`Ver Detalles`, buttonUrl: `${name} (tv : ${serieid})`}));
            agent.add(new Card({title: `Añadir a favoritos`,text: `Añádela a tu lista de favoritos`, buttonText: `Añadir a mis listas`,buttonUrl: `Añadir `}));
          }
        });
       }else{
         if(credits.data.crew.length>0){
           agent.add(new Card({title: `Series de ${personName}`,imageUrl: posterPath,text: `Algunas series famosas de ${personName} son:`}));
		   credits.data.crew.map((serie)=>{
          if(count<6){
            count++;
            var name = serie.name;
            var serieid =serie.id;
            var posterPath = imgPth+serie.poster_path;
            var job = serie.job;
            var jobTranslation;
               if(job=="Director"){
                 if(gender==1){jobTranslation="directora";}
                 if(gender==2){jobTranslation="director";}
               }
               if(job=="Executive Producer"){
                 if(gender==1){jobTranslation="productora ejecutiva";}
                 if(gender==2){jobTranslation="productor ejecutivo";}
               }
               if(job=="Producer"){
                 if(gender==1){jobTranslation="productora";}
                 if(gender==2){jobTranslation="productor";}
               }
               if(job=="Writer"||job=="Screenplay"||job=="Teleplay"){
                 jobTranslation="guionista";
               }
            var profession = personName+" es "+jobTranslation+" en "+name+" \n";
            var voteAverage = serie.vote_average==0?"":"Puntuación media: "+serie.vote_average+"\n";
            var releaseDate = "Fecha de estreno: "+serie.first_air_date+"\n";
            var episodes = serie.episode_count==0?"":"Aparece en "+serie.episode_count+" episodios \n";
            var overview = serie.overview==""?"":"Resumen: "+serie.overview;
            var cardText=profession+voteAverage+releaseDate+episodes+overview;
            agent.add(new Card({title: name,imageUrl: posterPath,text: cardText,
            buttonText:`Ver Detalles`, buttonUrl: `${name} (tv : ${serieid})`}));
            agent.add(new Card({title: `Añadir a favoritos`,text: `Añádela a tu lista de favoritos`, buttonText: `Añadir a mis listas`,buttonUrl: `Añadir `}));
          }
        });
         }else{agent.add(new Card({title: "Sin resultados" , text: `No se han encontrado resultados para ${medianame}. Vuelve a intentarlo`}));}
       }
     });
    }else{agent.add(new Card({title: "Sin resultados" , text: `No se han encontrado resultados para ${medianame}. Vuelve a intentarlo`}));}
  });
}

/*Searching media reviews*/
function handleSearchMediaReviews(){
  var medianame =agent.parameters.medianame;
  var auxname = medianame.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  var arrayName = auxname.split(" ");
  var queryName = arrayName.join('-');
  return axios.get(`${endpoint}/search/multi?api_key=${tmdbKey}&query=${queryName}&page=1&include_adult=false&language=es`)
    .then((result)=>{
    if(result.data.results.length>0){
      var element = result.data.results[0];
      var id = element.id;
      var type = element.media_type;
      var translation = type=="tv"?"serie":"película";
      var posterPath = imgPth+element.poster_path;
      var elementname = type=="tv"?element.name:element.title;
      return axios.get(`${endpoint}/${type}/${id}/reviews?api_key=${tmdbKey}&language=es&page=1`)
      .then((reviews)=>{
        if(reviews.data.results.length>0){
         agent.add(new Card({title: "Reseñas para la "+type+" "+elementname,imageUrl:posterPath,text: "Estas son algunas reseñas: "}));
         reviews.data.results.map((review)=>{ 
           var reviewAuthor = review.author;
           var content = review.content;
           agent.add(new Card({title: "Reseña de "+reviewAuthor,text: ""+content+""}));
           agent.add(new Card({title: `Detalles`,text: `Ver los detalles de ${elementname}`,buttonText: `Ver detalles`,
           buttonUrl: `${auxname} (${type} : ${id})`}));
         });
        }else{agent.add(new Card({title: "Sin reseñas" , text: `No hay reseñas para ${elementname}.`,
             imageUrl:posterPath,buttonText:`Ver detalles de ${elementname}`,buttonUrl:`${elementname} (${auxname} : ${id})`}));}
      });
    }else{agent.add(new Card({title: "Sin resultados" , text: `No se han encontrado resultados para ${medianame}. Vuelve a intentarlo`}));}
  });
}

/*Search Movies: Most Popular Movies of Genre*/
function handleSearchGenreMostPopularMovies(){
  var genreParameter =agent.parameters.genre;
  return axios.get(`${endpoint}/genre/movie/list?api_key=${tmdbKey}&language=es`)
      .then((result)=>{
    var genreConsultId;
    var genreConsultName;
    result.data.genres.map((genre)=>{
      var genreName = genre.name;
      var genreId = genre.id;
      if(genreParameter==genreName){
        genreConsultId = genreId;
        genreConsultName =genreName;
      }
    });
    return axios.get(`${endpoint}/discover/movie?api_key=${tmdbKey}&with_genres=${genreConsultId}&sort_by=popularity.desc&language=es`)
      .then((result)=>{
      agent.add(`Las películas más populares del género ${genreConsultName} son: `);
          result.data.results.map((movie)=>{
            var movieName = movie.title;
            var posterPath = imgPth+movie.poster_path;
            var cardText = 
                "Puntuación media: "+movie.vote_average+"\n"+
                "Resumen"+movie.overview+"";
            agent.add(new Card({
              title: movieName,
              imageUrl: posterPath,
              text: cardText
            }));
          });
    });
  });
}

/*Search Movies: Most Popular Movies of Year*/
function handleSearchYearMostPopularMovies(){
  var year = agent.parameters.year;
  agent.add(`Estas son las películas más populares del ${year}`);
  return axios.get(`${endpoint}/discover/movie?api_key=${tmdbKey}&primary_release_year=${year}&sort_by=popularity.desc`)
      .then((result)=>{
        result.data.results.map((movie)=>{
            var movieName = movie.title;
            var posterPath = imgPth+movie.poster_path;
            var cardText = 
                "Puntuación media: "+movie.vote_average+" \n "+
                "Resumen"+movie.overview+"";
            agent.add(new Card({
              title: movieName,
              imageUrl: posterPath,
              text: cardText
            }));
          });
  });
}

/*Search Movies: Most Popular Shows of Genre*/
function handleSearchGenreMostPopularShows(){
  var genreParameter =agent.parameters.genre;
  return axios.get(`${endpoint}/genre/movie/list?api_key=${tmdbKey}&language=es`)
      .then((result)=>{
    var genreConsultId;
    var genreConsultName;
    result.data.genres.map((genre)=>{
      var genreName = genre.name;
      var genreId = genre.id;
      if(genreParameter==genreName){
        genreConsultId = genreId;
        genreConsultName =genreName;
      }
    });
    return axios.get(`${endpoint}/discover/tv?api_key=${tmdbKey}&with_genres=${genreConsultId}&sort_by=popularity.desc&language=es`)
      .then((result)=>{
      agent.add(`Las series más populares del género ${genreConsultName} son: `);
          result.data.results.map((show)=>{
            var showName = show.name;
            var posterPath = imgPth+show.poster_path;
            var voteAverage = show.vote_average==0?"":"Puntuación: "+show.vote_average+"\n";
            var overview = show.overview==""?"":"Resumen: \n"+show.overview;
            var cardText = voteAverage+overview;
               
            agent.add(new Card({title: showName,imageUrl: posterPath,text: cardText}));
          });
    });
  });
}

/*Search Genre & Year Most Popular Movies*/
function handleSearchGenreYearMostPopularMovies(){
  var genreParameter = agent.parameters.genre;
  var year = agent.parameters.year;
  return axios.get(`${endpoint}/genre/movie/list?api_key=${tmdbKey}&language=es`)
      .then((result)=>{
    var genreId;
    var genreName;
    result.data.genres.map((genre)=>{
      if(genre.name == genreParameter){
        genreId = genre.id;
        genreName = genre.name;
      }
    });
    agent.add(`Genre Id: ${genreId}, Genre Name: ${genreName}`);
     return axios.get(`${endpoint}/discover/movie?api_key=${tmdbKey}&primary_release_year=${year}&with_genres=${genreId}&sort_by=popularity.desc`)
      .then((movies)=>{
       movies.data.results.map((movie)=>{
            var movieName = movie.title;
            var posterPath = imgPth+movie.poster_path;
            var cardText = 
                "Puntuación media: "+movie.vote_average+" \n "+
                "Resumen: "+movie.overview+"";
            agent.add(new Card({
              title: movieName,
              imageUrl: posterPath,
              text: cardText
            }));
          });
     });
  });
}

/*Search Year Actor Most Poular Movies*/
 function handleSearchYearActorMostPopularMovies(){
  var medianame =agent.parameters.medianame;
  var auxname = medianame.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  var arrayName = auxname.split(" ");
  var queryName = arrayName.join('-');
  var year = agent.parameters.year;
  return axios.get(`${endpoint}/search/person?api_key=${tmdbKey}&query=${queryName}&language=es&page=1&include_adult=true`)
    .then((result)=>{
    var element = result.data.results[0];
    var personId = element.id;
    return axios.get(`${endpoint}/person/${personId}/movie_credits?api_key=${tmdbKey}&language=es&sort_by=popularity.desc`)
    .then((credits)=>{
      credits.data.cast.map((element)=>{
        var releaseDate = element.release_date;
        if(releaseDate!=undefined){
          var arrayDate = releaseDate.split('-');
          var releaseYear = arrayDate[0];
          if(releaseYear == year){
            var name = element.title;
            var posterPath = imgPth+element.poster_path;
            var character = "Personaje: "+element.character;
            agent.add(new Card({
              title: name,
              imageUrl: posterPath,
              text: character
            }));
          }
        }
      });  
    });
  });
}

/*Actor & Genre Movies*/
function handleSearchGenreActorMostPopularMovies(){
  var medianame =agent.parameters.medianame;
  var auxname = medianame.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  var arrayName = auxname.split(" ");
  var queryName = arrayName.join('-');
  var genreParameter = agent.parameters.genre;
  return axios.get(`${endpoint}/genre/movie/list?api_key=${tmdbKey}&language=es`)
      .then((result)=>{
    var genreId;
    var genreName;
    result.data.genres.map((genre)=>{
      if(genre.name == genreParameter){
        genreId = genre.id;
        genreName = genre.name;
      }
    });
    agent.add(`Genre: ${genreId}`);
    return axios.get(`${endpoint}/search/person?api_key=${tmdbKey}&query=${queryName}&language=es&page=1&include_adult=true`)
    .then((person)=>{
      var element = person.data.results[0];
      var personId = element.id;
      var personName = element.name;
      return axios.get(`${endpoint}/person/${personId}/movie_credits?api_key=${tmdbKey}&language=es&sort_by=popularity.desc`)
    .then((credits)=>{
        credits.data.cast.map((movie)=>{
            var arraygenres = movie.genre_ids;
          if(arraygenres.includes(genreId)){
            var name = movie.title;
            var posterPath = imgPth+movie.poster_path;
            var character = "Personaje: "+movie.character;
            agent.add(new Card({
              title: name,
              imageUrl: posterPath,
              text: character
            }));
          }
        });
      });
    });
  });
}

/*************SPECIF INFO SEARCH **********/
  /*Media Release Date*/
  function handleSearchMediaDate(){
    const medianame = agent.parameters.medianame;
    var auxname = medianame.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    var arrayName = auxname.split(" ");
    var queryName = arrayName.join('-');
    return axios.get(`${endpoint}/search/multi?api_key=${tmdbKey}&query=${queryName}&page=1&include_adult=false&language=es`)
      .then((result)=>{
      if(result.data.results.length>0){
        var element = result.data.results[0];
        var type=element.media_type;
        var posterPath = element.backdrop_path==null?"":imgPth+element.backdrop_path;
        var title = type=="movie"?element.title:element.name;
        var typetranslation = type=="tv"?"serie":"película";
        var id = element.id;
        var date = type=="tv"?element.first_air_date:element.release_date;
        agent.add(`${title} (${type} : ${id})`);
        if(type=="tv"||type=="movie"){
          agent.add(new Card({title: "Fecha de estreno" ,imageUrl: posterPath,text: `La fecha de estreno de la ${typetranslation} ${title} es ${date}`,
          buttonText:`Ver detalles de ${title}`, buttonUrl:`${title} (${type} : ${id})`}));
        }
        if(type=="person"){
          agent.add(new Card({title: "Fecha de estreno" ,text: `Prueba a buscar la fecha de estreno de una serie o película.`}));
        }
      }else{
        agent.add(new Card({title: "Sin resultados" , text: `No se han encontrado resultados para ${medianame}. Vuelve a intentarlo`}));
      }
    });
  }
  
  /*Media Rating*/
  function handleSearchMediaRating(){
    const medianame = agent.parameters.medianame;
    var auxname = medianame.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    var arrayName = auxname.split(" ");
    var queryName = arrayName.join('-');
    return axios.get(`${endpoint}/search/multi?api_key=${tmdbKey}&query=${queryName}&page=1&include_adult=false&language=es`)
      .then((result)=>{
      if(result.data.results.length>0){
        var element = result.data.results[0];
        var id = element.id;
        var type=element.media_type;
        var typetranslation=type=="tv"?"serie":"película";
        var rating = element.vote_average;
        var posterPath = element.backdrop_path==null?"":imgPth+element.backdrop_path;
        if(type=="tv"||type=="movie"){
          var name = type=="tv"?element.name:element.title;
          agent.add(new Card({title: "Puntuación media" ,imageUrl: posterPath,text: `La puntuación media de la ${typetranslation} ${name} es ${rating} puntos sobre 10.`,
          buttonText:`Detalles de ${name}`, buttonUrl:`${name} (${type} : ${id})`}));
        }
        if(type=="person"){
          agent.add(new Card({title: "Puntuación media" ,text: `Prueba a buscar la puntuación media para una serie o película.`}));
        }
      }else{
        agent.add(new Card({title: "Sin resultados" , text: `No se han encontrado resultados para ${medianame}. Vuelve a intentarlo`}));
      }
    });
  }
  
  /*Media Review*/
  function handleSearchMediaOverview(){
    const medianame = agent.parameters.medianame;
    var auxname = medianame.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    var arrayName = auxname.split(" ");
    var queryName = arrayName.join('-');
    return axios.get(`${endpoint}/search/multi?api_key=${tmdbKey}&query=${queryName}&page=1&include_adult=false&language=es`)
      .then((result)=>{
      if(result.data.results.length>0){
        var element = result.data.results[0];
        var id = element.id;
        var type=element.media_type;
        var typetranslation = type=="tv"?"serie":"película";
        var overview = element.overview;
        var posterPath = element.backdrop_path==null?"":imgPth+element.backdrop_path;
        if(type=="tv"||type=="movie"){
          var name = type=="tv"?element.name:element.title;
          if(overview!=""){
            agent.add(new Card({title: `Sipnosis de la ${typetranslation} ${name}`,imageUrl: posterPath,text: `${overview}`,
            buttonText:`Ver detalles de ${name}`,buttonUrl:`${name} (${type} : ${id})`}));
          }else{
            agent.add(new Card({title: `Sipnosis`,imageUrl: posterPath,text: `La ${typetranslation} ${name} no tiene sipnosis.`,
            buttonText:`Ver detalles de ${name}`,buttonUrl:`${name} (${type} : ${id})`}));
          }
        }
        if(type=="person"){
          agent.add(new Card({title: `Sipnosis`,imageUrl: posterPath,text: `Prueba a buscar la sipnosis de una película.`}));
        }
      }else{
        agent.add(new Card({title: "Sin resultados" , text: `No se han encontrado resultados para ${medianame}. Vuelve a intentarlo`}));
      }
    });
  }
  
  /*Media Language*/
  function handleSearchMediaLanguage(){
    const medianame = agent.parameters.medianame;
    var auxname = medianame.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    var arrayName = auxname.split(" ");
    var queryName = arrayName.join('-');
    return axios.get(`${endpoint}/search/multi?api_key=${tmdbKey}&query=${queryName}&page=1&include_adult=false&language=es`)
      .then((result)=>{
      if(result.data.results.length>0){
        var element = result.data.results[0];
        var id = element.id;
        var type=element.media_type;
	 	 var originallanguage = element.original_language;
     	 var lang = ISO6391.getName(originallanguage);
         var langtranslation;
         if(lang=="English"){
            langtranslation="inglés";
          }else{
            if(lang=="French"){
              langtranslation="francés";
            }else{
              if(lang=="Spanish"){
                langtranslation="español";
              }else{
                if(lang=="Italian"){
                  langtranslation="italiano";
                }else{
                  if(lang=="German"){
                    langtranslation="alemán";
                  }else{
                    if(lang=="Chinese"){
                      langtranslation="chino";
                    }else{
                      if(lang=="Korean"){
                        langtranslation="coreano";
                      }else{
                        if(lang=="Japanese"){
                          langtranslation="japonés";
                        }else{
                          langtranslation=lang.toLowerCase();
                        }
                      }
                    }
                  }
                } 
              }
            }
          }
        var posterPath = element.backdrop_path==null?"":imgPth+element.backdrop_path;
        var translation = type=="tv"?"serie":"película";
        if(type=="tv"||type=="movie"){
          var name = type=="movie"?element.title:element.name;
          agent.add(new Card({title: "Idioma original" ,imageUrl:posterPath, text: `El idioma original de la ${translation} ${name} es ${langtranslation}.`,
          buttonText:`Ver detalles de ${name}`, buttonUrl:`${name} (${type} : ${id})`}));
        }
        if(type=="person"){
          agent.add(new Card({title: "Idioma original" ,text: `Prueba a buscar el idioma original para una serie o película.`}));
        }
      }else{agent.add(new Card({title: "Sin resultados" , text: `No se han encontrado resultados para ${medianame}. Vuelve a intentarlo`}));}
    });
  }
  
  /*Tv Number of Seasons*/
  function handleSearchTvSeasons(){
    var medianame =agent.parameters.medianame;
    var auxname = medianame.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    var arrayName = auxname.split(" ");
    var queryName = arrayName.join('-');
    return axios.get(`${endpoint}/search/multi?api_key=${tmdbKey}&query=${queryName}&page=1&include_adult=false&language=es`)
      .then((result)=>{
      if(result.data.results.length>0){
      var element = result.data.results[0];
      var tvId = element.id;
      return axios.get(`${endpoint}/tv/${tvId}?api_key=${tmdbKey}&language=en-US`)
      .then((series)=>{
        if(series!=null){
        var serie = series.data;
        var serieid = serie.id;
        var name = serie.name;
       	var numberSeasons = serie.number_of_seasons;
       	var numberEpisodes = serie.number_of_episodes;
        var posterPath = element.backdrop_path==null?"":imgPth+element.backdrop_path;
		agent.add(new Card({title: "Temporadas y episodios" ,imageUrl:posterPath, text: `El número de temporadas de la serie ${name} es ${numberSeasons}. En total tiene ${numberEpisodes} episodios.`}));
        for (var i = 1; i <=numberSeasons; i++) {
        	agent.add(new Card({title:`Temporada ${i}`,text:`Ver detalles de la temporada ${i}`,
            buttonText:`Detalles de la temporada ${i}`,buttonUrl:`Temporada ${i} de la serie ${name}`}));
        }
          agent.add(new Card({title: `Detalles`,text: `Volver a los detalles de ${name}`,buttonText: `Ver detalles`,buttonUrl: `${name} (tv : ${serieid})`}));
        }else{agent.add(new Card({title: "Sin resultados" , text: `No se han encontrado resultados para ${medianame}. Vuelve a intentarlo`}));}
        });
      }else{agent.add(new Card({title: "Sin resultados" , text: `No se han encontrado resultados para ${medianame}. Vuelve a intentarlo`}));}
     });
  }

   /*Media genres*/
  function handleSearchMediaGenres(){
    var medianame =agent.parameters.medianame;
    var auxname = medianame.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    var arrayName = auxname.split(" ");
    var queryName = arrayName.join('-');
     return axios.get(`${endpoint}/search/multi?api_key=${tmdbKey}&query=${queryName}&page=1&include_adult=false&language=es`)
      .then((result)=>{
        if(result.data.results.length>0){
          var element = result.data.results[0];
          var type = element.media_type;
          var elementname = type=="tv"?element.name:element.title;
          var mediaid = element.id;
          var posterPath = imgPth+element.backdrop_path;
          return axios.get(`${endpoint}/${type}/${mediaid}?api_key=${tmdbKey}&language=es`)
      		.then((media)=>{
            if(media!=null){
              var cardText = "Los géneros de "+elementname+" son: ";
              media.data.genres.map((genre)=>{cardText=cardText+genre.name+" ";});
              agent.add(new Card({title: `Géneros de ${elementname}` , text: `${cardText}`, imageUrl: posterPath,
              buttonText: `Ver detalles de ${elementname}`,buttonUrl: `${elementname} (${type} : ${mediaid})`}));
            }else{agent.add(new Card({title: "Sin resultados" , text: `No se han encontrado resultados para ${medianame}. Vuelve a intentarlo`}));}
          });
        }else{agent.add(new Card({title: "Sin resultados" , text: `No se han encontrado resultados para ${medianame}. Vuelve a intentarlo`}));}
     });
  }

  /*Original title*/
  function handleSearchMediaOriginalTitle(){
    var medianame =agent.parameters.medianame;
    var auxname = medianame.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    var arrayName = auxname.split(" ");
    var queryName = arrayName.join('-');
    return axios.get(`${endpoint}/search/multi?api_key=${tmdbKey}&query=${queryName}&page=1&include_adult=false&language=es`)
      .then((result)=>{
      if(result.data.results.length>0){
      var element = result.data.results[0];
      var id = element.id;
      var type = element.media_type;
      var title = type == "tv"?element.name:element.title;
      var originalTitle= type=="tv"?element.original_name:element.original_title;
      var translation = type == "tv"?"serie":"película";
      var originallanguage = element.original_language;
      var lang = ISO6391.getName(originallanguage);
      var langtranslation;
      if(lang=="English"){
        langtranslation="inglés";
      }else{
        if(lang=="French"){
          langtranslation="francés";
        }else{
          if(lang=="Spanish"){
            langtranslation="español";
          }else{
         	if(lang=="Italian"){
              langtranslation="italiano";
            }else{
              if(lang=="German"){
                langtranslation="alemán";
              }else{
                if(lang=="Chinese"){
                  langtranslation="chino";
                }else{
                  if(lang=="Korean"){
                  	langtranslation="coreano";
                  }else{
                    if(lang=="Japanese"){
                      langtranslation="japonés";
                    }else{
                      langtranslation=lang;
                    }
                  }
                }
              }
            } 
          }
        }
      } 
      var posterPath = imgPth+element.backdrop_path;
      var cardText = "El título original de la "+translation+" en "+langtranslation+" es "+originalTitle;
      agent.add(new Card({title: `Título original de ${title}` , text: `${cardText}`, imageUrl: posterPath,
      buttonText:`Ver detalles de ${title}`,buttonUrl:`${title} (${type} : ${id})`}));
     }else{agent.add(new Card({title: "Sin resultados" , text: `No se han encontrado resultados para ${medianame}. Vuelve a intentarlo`}));}
    });
  }
  
  /*Official web page of series or movie*/
  function handleSearchMediaOfficialPage(){
    var medianame =agent.parameters.medianame;
    var auxname = medianame.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    var arrayName = auxname.split(" ");
    var queryName = arrayName.join('-');
     return axios.get(`${endpoint}/search/multi?api_key=${tmdbKey}&query=${queryName}&page=1&include_adult=false&language=es`)
      .then((result)=>{
       if(result.data.results.length>0){
       var element = result.data.results[0];
       var elementid = element.id;
       var type = element.media_type;
       var translation = type=="tv"?"serie":"película";
       var elementname = type =="tv"?element.name:element.title;
       var posterPath = imgPth+element.backdrop_path;
       return axios.get(`${endpoint}/${type}/${elementid}?api_key=${tmdbKey}&language=es`)
      .then((media)=>{
         if(media!=null){
           var homepage = media.data.homepage;
           if(homepage!=""){
           agent.add(new Card({title: `Página web de ${elementname}`,imageUrl: posterPath,text:`La página web de la ${translation} ${elementname} es ${homepage}`,
           buttonText:`Ver detalles de ${elementname}`, buttonUrl:`${elementname} (${type} : ${elementid})`}));
           }else{agent.add(`La ${translation} ${elementname} no tiene página web`);}         
         }else{agent.add(new Card({title: "Sin resultados" , text: `No se han encontrado resultados para ${medianame}. Vuelve a intentarlo`}));}
       });
      }else{agent.add(new Card({title: "Sin resultados" , text: `No se han encontrado resultados para ${medianame}. Vuelve a intentarlo`}));}
     });
  }
  
  /*Media Videos*/
  function handleSearchMediaVideos(){
    var medianame =agent.parameters.medianame;
    var auxname = medianame.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    var arrayName = auxname.split(" ");
    var queryName = arrayName.join('-');
    return axios.get(`${endpoint}/search/multi?api_key=${tmdbKey}&query=${queryName}&page=1&include_adult=false&language=es`)
    .then((result)=>{
      if(result.data.results.length>0){
        var element = result.data.results[0];
        var elementid = element.id;
        var type = element.media_type;
        var elementname = type=="tv"?element.name:element.title;
        var translation = type=="tv"?"serie":"película";
        var posterPath = imgPth+element.backdrop_path;
        return yts("trailer "+elementname+" castellano").then((response)=>{
          console.log("TRAILER: "+JSON.stringify(response.all));
          var videos = response.all;
          if(videos.length>0){
          agent.add(new Card({title:`Videos de ${elementname}`,text:`Videos y trailer de ${elementname}`,imageUrl:posterPath}));
          var count=0;
          videos.map((video)=>{
            if(count<3){
              count++;
              agent.add(`${video.url}`);
            }
          });
            agent.add(new Card({title: `Detalles`,text: `Volver a los detalles de ${elementname}`,buttonText: `Ver detalles`,buttonUrl: `${elementname} (${type} : ${elementid})`}));
          }else{agent.add(new Card({title: "Sin resultados" , text: `No se han encontrado resultados para ${medianame}. Vuelve a intentarlo`}));}
        });
      }else{agent.add(new Card({title: "Sin resultados" , text: `No se han encontrado resultados para ${medianame}. Vuelve a intentarlo`}));}
    });
  }
  
  /*Age recommendation for movie or series*/
  function handleSearchMediaIsAdult(){
    var medianame =agent.parameters.medianame;
    var auxname = medianame.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    var arrayName = auxname.split(" ");
    var queryName = arrayName.join('-');
    return axios.get(`${endpoint}/search/multi?api_key=${tmdbKey}&query=${queryName}&page=1&include_adult=false&language=es`)
    .then((result)=>{
      if(result.data.results.length>0){
      var element = result.data.results[0];
      var id = element.id;
      var type = element.media_type;
      var elementname = type=="tv"?element.name:element.title;
      var translation = type=="tv"?"serie":"película";
      var posterPath = imgPth+element.backdrop_path;
      var certification;
      return axios.get(`https://www.themoviedb.org/${type}/${id}-${queryName}?language=es`)
      .then((res)=>{
        const $ = cheerio.load(res.data);
        var meaning="";
        if(type=="tv"){
        certification = $('div.page_wrap.tv_wrap')
        .find('main.smaller.subtle.show_search_false')
        .find('section.inner_content.tv_content.backdrop.poster')
        .find('div.header.large.border.first')
        .find('div.single_column').find('section.images.inner')
        .find('div.header_poster_wrapper.true')
        .find('section.header.poster').find('div.title.ott_true')
        .find('div.facts').find('span.certification').text();
         certification = certification.trim();
         if(certification=="NR"||certification=="Exempt"||certification=="-"||
             certification=="Unrated"||certification=="X"){
              meaning="No hay calificación de edad para esta serie.";
          }
          if(certification=="0+"||certification=="TV-Y"||certification=="TV-G"||
             certification=="G"||certification=="P"||certification=="0"||
             certification=="ส"||certification=="ท"||certification=="ALL"||
             certification=="U"||certification=="L"||certification=="AL"||
             certification=="T"||certification=="Children"||certification=="Infantil"||
             certification=="TP"){
            	meaning="La serie es para todos los públicos.";
          }
          if(certification=="6+"||certification=="C"||certification=="6"){
            	meaning="La serie es recomendada para niños mayores de 6 años.";
          }
          if(certification=="TV-Y7"||certification=="TV-PG"||certification=="C8"||
             certification=="7"||certification=="8+"||certification=="N-7"){
            	meaning="La serie es recomendada para niños mayores de 7 años.";
          }
          if(certification=="10"||certification=="9"||certification=="10AP"){
            	meaning="La serie es recomendada para niños mayores de 10 años.";
          }
          if(certification=="12+"||certification=="PG"||certification=="M"||
             certification=="12"||certification=="12A"||certification=="12AP"||
            certification=="13"){
              meaning="La serie es recomendada para niños mayores de 12 años.";
          }
          if(certification=="TV-14"||certification=="14+"||certification=="น 13+"||
             certification=="14"||certification=="13+"||certification=="N-14"||
             certification=="15"){
            	meaning="La serie es recomendada para mayores de 14 años.";
          }
          if(certification=="16+"||certification=="TV-MA"||certification=="MA15+"||
             certification=="AV15+"||certification=="16"||certification=="น 15+"||
             certification=="15"||certification=="SPG"){
            	meaning="La serie es recomendada para mayores de 16 años.";
          }
          if(certification=="18+"||certification=="R18"||certification=="น 18+"||
             certification=="ฉ 20-"||certification=="19"||certification=="S"){
            	meaning="La serie es recomendada para mayores de 18 años.";
          }
        }
        if(type=="movie"){
        certification=$('div.page_wrap.movie_wrap')
        .find('main.smaller.subtle.show_search_false')
        .find('section.inner_content.movie_content.backdrop.poster')
        .find('div.header.large.border.first').find('div.keyboard_s.custom_bg')
        .find('div.single_column').find('section.images.inner')
        .find('div.header_poster_wrapper.true').find('section.header.poster')
        .find('div.title.ott_true').find('div.facts').find('span.certification').text();
         certification = certification.trim();
        if(certification=="NR"||certification=="E"||certification=="RC"||
           certification=="KK"||certification=="F"){
             meaning="No existe calificación de edad para esta película";
        }
        if(certification=="G"||certification=="0"||certification=="U"||
           certification=="AL"||certification=="S"||certification=="A"||
           certification=="B"||certification=="APTA"||certification=="Públicos"||
           certification=="M/3"||certification=="Btl"||certification=="KN"||
           certification=="V"||certification=="0+"||certification=="T"){
             meaning="La película es para todos los públicos.";
        }
        if(certification=="6"||certification=="K-7"||certification=="7"||
           certification=="M/6"||certification=="N-7"||certification=="6+"){
             meaning="La película es para mayores de 7 años.";
        }
        if(certification=="PG"||certification=="10"||certification=="9"||
           certification=="11"){
             meaning="La película es para mayores de 10 años.";
        }
        if(certification=="PG-13"||certification=="14A"||certification=="12"||
           certification=="13"||certification=="UA"||certification=="12A"||
           certification=="L"||certification=="14"||certification=="K-12"||
           certification=="C"||certification=="M/12"||certification=="M/14"||
           certification=="P13"||certification=="13+"||certification=="N-13"||
           certification=="12+"||certification=="R-13"||certification=="VM14"){
             meaning="La película es para mayores de 13 años.";
        }
        if(certification=="M"||certification=="MA15+"||certification=="16"||
           certification=="15"||certification=="K-16"||certification=="D"||
           certification=="M/16"||certification=="16+"||certification=="N-16"||
           certification=="R-16"){
             meaning="La película es para mayores de 16 años.";
        }
        if(certification=="R"||certification=="NC-17"||certification=="18A"||
           certification=="A"||certification=="R18+"||certification=="X18+"||
           certification=="18"||certification=="R18"||certification=="K-18"||
           certification=="X"||certification=="M/18"||certification=="P"||
           certification=="18SG"||certification=="18SX"||certification=="18PA"||
           certification=="18PL"||certification=="18+"||certification=="N-18"||
           certification=="R-18"||certification=="VM18"){
             meaning="La película es para mayores de 18 años.";
        }
      }
      agent.add(new Card({title:`Calificación de edad de ${elementname}`,text:`${meaning} `,imageUrl:posterPath,
      buttonText:`Ver detalles de ${elementname}`,buttonUrl:`${elementname} (${type} : ${id})`}));  
      });
     }else{agent.add(new Card({title: "Sin resultados" , text: `No se han encontrado resultados para ${medianame}. Vuelve a intentarlo`}));}
    });
  }

  /*Seach actor biography*/
  function handleSearchPersonBiography(){
    var medianame =agent.parameters.medianame;
    var auxname = medianame.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    var arrayName = auxname.split(" ");
    var queryName = arrayName.join('-');
    return axios.get(`${endpoint}/search/person?api_key=${tmdbKey}&query=${queryName}&language=es&page=1&include_adult=false`)
      .then((result)=>{
      if(result.data.results.length>0){
      var element = result.data.results[0];
      var id = element.id;
      return axios.get(`${endpoint}/person/${id}?api_key=${tmdbKey}&language=es`)
      .then((person)=>{
         if(person!=null){
          var prs =person.data;
          var personname = prs.name;
          var biography = prs.biography;
          var gender = prs.gender;
          var department = prs.known_for_department;
          var profession;
          if(department=="Acting"){
            if(gender=="1"){profession="Actriz";}
            if(gender=="2"){profession="Actor";}
          }
          if(department=="Production"){
            if(gender=="1"){profession="Productora";}
            if(gender=="2"){profession="Productor";}
          }
          if(department=="Directing"){
            if(gender=="1"){profession="Directora";}
            if(gender=="2"){profession="Director";}
          }
          if(department=="Writing"){
            profession="Guionista";
          }
          var cardTitle = "Biografía de "+personname+" ("+profession+")";
          var cardText=biography==""?"La biografía de "+personname+" no está registrada.":biography;
          var posterPath=prs.profile_path==null?"":imgPth+prs.profile_path;
          agent.add(new Card({title: cardTitle,imageUrl:posterPath,text: cardText,
          buttonText:`Detalles de ${personname}`,buttonUrl:`${personname} (person : ${id})`}));
        }else{agent.add(new Card({title: "Sin resultados" , text: `No se han encontrado resultados para ${medianame}. Vuelve a intentarlo`}));}
      });
     }else{agent.add(new Card({title: "Sin resultados" , text: `No se han encontrado resultados para ${medianame}. Vuelve a intentarlo`}));}
    });
  }
  
  /*Birthday and age of a person*/
  function handleSearchPersonBirthdate(){
    var medianame =agent.parameters.medianame;
    var auxname = medianame.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    var arrayName = auxname.split(" ");
    var queryName = arrayName.join('-');
    return axios.get(`${endpoint}/search/person?api_key=${tmdbKey}&query=${queryName}&language=es&page=1&include_adult=false`)
      .then((result)=>{
      if(result.data.results.length>0){
      var element = result.data.results[0];
      var id = element.id;
      return axios.get(`${endpoint}/person/${id}?api_key=${tmdbKey}&language=es`)
      .then((person)=>{
         if(person!=null){
          var prs =person.data;
          var personname = prs.name;
          var birthday = prs.birthday;
          var age = getAge(birthday);
          var placebirth = prs.place_of_birth; 
          var gender = prs.gender;
          var posterPath=imgPth+prs.profile_path;
          var department = prs.known_for_department;
          var profession;
          if(department=="Acting"){
            if(gender=="1"){profession="Actriz";}
            if(gender=="2"){profession="Actor";}
          }
          if(department=="Production"){
            if(gender=="1"){profession="Productora";}
            if(gender=="2"){profession="Productor";}
          }
          if(department=="Directing"){
            if(gender=="1"){profession="Directora";}
            if(gender=="2"){profession="Director";}
          }
          if(department=="Writing"){
            profession="Guionista";
          }
          var cardTitle = "Fecha de nacimiento de "+personname+" ("+profession+")";
          var cardText = personname+" es "+profession+" y tiene "+age+" años. Nació el "+birthday+" en "+placebirth; 
          agent.add(new Card({title: cardTitle,imageUrl:posterPath,text: cardText,
          buttonText:`Detalles de ${personname}`,buttonUrl:`${personname} (person : ${id})`}));
        }else{agent.add(new Card({title: "Sin resultados" , text: `No se han encontrado resultados para ${medianame}. Vuelve a intentarlo`}));}
      });
      }else{agent.add(new Card({title: "Sin resultados" , text: `No se han encontrado resultados para ${medianame}. Vuelve a intentarlo`}));}
    });
  }
  
  /*Search Person role in media*/
  function handleSearchPersonRoleInMedia(){
    var medianame =agent.parameters.medianame;
    var auxname = medianame.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    var arrayMovie = auxname.split(" ");
    var queryMovie = arrayMovie.join('-');
    var personname = agent.parameters.personname;
    var auxperson= personname.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    var arrayName = auxperson.split(" ");
    var queryName = arrayName.join('-');
    return axios.get(`${endpoint}/search/person?api_key=${tmdbKey}&query=${queryName}&language=es&page=1`)
    .then((result)=>{
      if(result.data.results.length>0){
        var person = result.data.results[0];
        var personId = person.id;
        var gender = person.gender;
        var personName = person.name;
        var profession = gender=="1"?"actriz":"actor";
        return axios.get(`${endpoint}/search/multi?api_key=${tmdbKey}&query=${queryMovie}&language=es&page=1`)
      	.then((media)=>{
          if(media.data.results.length>0){
          var med = media.data.results[0];
          var type = med.media_type;
          var translation = type=="tv"?"serie":"película";
          var mediaid = med.id;
          var title = type=="tv"?med.name:med.title;
          var originalTitle = type=="tv"?med.original_name:med.original_title;
          return axios.get(`${endpoint}/person/${personId}/${type}_credits?api_key=${tmdbKey}&language=es&sort_by=popularity.desc`)
      	  .then((credits)=>{
          var isActor=false;
          var isCrew=false;
          if(credits.data.cast.length>0){
            credits.data.cast.map((cast)=>{
               var creditTitle=type=="tv"?cast.name:cast.title;
          	   var creditOriginalTitle =type=="tv"?cast.original_name:cast.original_title;
               if(title==creditTitle||originalTitle==creditOriginalTitle){
                 isActor=true;
                 var posterPath = imgPth+cast.backdrop_path;
            	 var character = cast.character;
                 var cardText = personName+" es "+profession+" en la "+translation+" "+title+
                 " e interpreta a "+character+".";
                 agent.add(new Card({title: `Personaje de ${personName} en ${title}`,imageUrl:posterPath,text: cardText}));
               }
             });
           }
           if(credits.data.crew.length>0){
             credits.data.crew.map((crew)=>{
               var creditTitle=type=="tv"?crew.name:crew.title;
          	   var creditOriginalTitle =type=="tv"?crew.original_name:crew.original_title;
               var posterPath = imgPth+crew.backdrop_path;
               var job = crew.job;
               var jobTranslation;
               if(job=="Director"){
                 if(gender==1){jobTranslation="directora";}
                 if(gender==2){jobTranslation="director";}
               }
               if(job=="Executive Producer"){
                 if(gender==1){jobTranslation="productora ejecutiva";}
                 if(gender==2){jobTranslation="productor ejecutivo";}
               }
               if(job=="Producer"){
                 if(gender==1){jobTranslation="productora";}
                 if(gender==2){jobTranslation="productor";}
               }
               if(job=="Writer"||job=="Screenplay"||job=="Teleplay"){
                 jobTranslation="guionista";
               }
               if(title==creditTitle||originalTitle==creditOriginalTitle){
                 isCrew=true;
                 var cardText = personName+" es "+jobTranslation+" en la "+translation+" "+title;
                 if(!isActor){
                   agent.add(new Image(posterPath));
                 }
                 agent.add(new Card({title: `${personName} en el equipo de ${creditTitle}`,text: cardText}));
                }
             });
           }
           if(!isActor && !isCrew){
             agent.add(new Card({title: "No aparece" , text: `${personName} no aparece en ${title}.`}));
           }
          });
         }else{agent.add(new Card({title: "Sin resultados" , text: `No se han encontrado resultados para ${medianame}. Vuelve a intentarlo`}));}
        });
      }else{agent.add(new Card({title: "Sin resultados" , text: `No se han encontrado resultados para ${personname}. Vuelve a intentarlo`}));}
    });
  }

  /*Movie Info: Duration*/
  function handleSearchMovieDuration(){
    const medianame = agent.parameters.medianame;
    var auxname = medianame.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    var arrayName = auxname.split(" ");
    var queryName = arrayName.join('-');
    return axios.get(`${endpoint}/search/multi?api_key=${tmdbKey}&query=${queryName}&page=1&include_adult=false&language=es`)
      .then((result)=>{
      if(result.data.results.length>0){
        var element = result.data.results[0];
        var type = element.media_type;
      	var id = element.id;
      	var name = type=="tv"?element.name:element.title;
        var posterPath=imgPth+element.backdrop_path;
        if(type=="movie"){
        return axios.get(`${endpoint}/movie/${id}?api_key=${tmdbKey}`)
      	.then((movie)=>{
          if(movie!=null){
            var mv = movie.data;
            var runtime = mv.runtime;
            var cardText;
            if(runtime!=0){
              cardText=`La duración de la película ${name} es ${runtime} minutos.`;
            }else{
              cardText=`La duración de la película ${name} no está definida.`;
            }
            agent.add(new Card({title:`Duración de ${name}`,text:cardText,imageUrl:posterPath,
            buttonText:`Ver detalles de ${name}`,buttonUrl:`${name} (${type} : ${id})`}));
          }else{agent.add(new Card({title: "Sin resultados" , text: `No se han encontrado resultados para ${medianame}. Vuelve a intentarlo`}));}
       });
      }else{agent.add(new Card({title: `Serie ${name}` ,imageUrl:posterPath, text: `${name} es una serie. Prueba a buscar por episodios.`}));}
     }else{agent.add(new Card({title: "Sin resultados" , text: `No se han encontrado resultados para ${medianame}. Vuelve a intentarlo`}));}  
    });
  }
  
  /*Media images*/
  function handleSearchMediaImages(){
    var medianame = agent.parameters.medianame;
    var auxname = medianame.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    var arrayName = auxname.split(" ");
    var queryName = arrayName.join('-');
    return axios.get(`${endpoint}/search/multi?api_key=${tmdbKey}&query=${queryName}&page=1&include_adult=false&language=es`)
    .then((result)=>{
      if(result.data.results.length>0){
        var element = result.data.results[0];
        var type = element.media_type;
        var elementid = element.id;
        var elementname = type=="movie"?element.title:element.name;
        var count=0;
        return axios.get(`${endpoint}/${type}/${elementid}/images?api_key=${tmdbKey}&language=es`)
      	.then((photos)=>{
          if(type=="movie"||type=="tv"){
            var backdrops = photos.data.backdrops;
            var posters = photos.data.posters;
            if(backdrops.length>0){
              agent.add(new Card({title:`Imágenes de ${elementname}`,text:`Estas son algunas fotos de ${elementname}`}));
              posters.map((backdrop)=>{
                if(count<4){
                count++;
                agent.add(new Image(imgPth+backdrop.file_path));
                }
              });
               agent.add(new Card({title: `Detalles`,text: `Ver los detalles de ${elementname}`,buttonText: `Ver detalles`,
              buttonUrl: `${elementname} (${type} : ${elementid})`}));
            }else{
              if(posters.length>0){
                agent.add(new Card({title:`Posters de ${elementname}`,text:`Estos son algunos posters de ${elementname}`}));
                posters.map((poster)=>{
                  if(count<4){
                  count++;
                  agent.add(new Image(imgPth+poster.file_path));
                  }
                });
                 agent.add(new Card({title: `Detalles`,text: `Ver los detalles de ${elementname}`,buttonText: `Ver detalles`,buttonUrl: `${elementname} (${type} : ${elementid})`}));
              }else{agent.add(new Card({title: "Sin imágenes" , text: `No se han encontrado fotos para ${elementname}`}));}
            }
          }else{
            if(type=="person"){
              if(photos.data.profiles.length>0){
                agent.add(new Card({title:`Fotos de ${elementname}`,text:`Estas son algunas imágenes de ${elementname}`}));
                photos.data.profiles.map((profile)=>{
                  if(count<4){
                  count++;
                  agent.add(new Image(imgPth+profile.file_path));
                  }
                });
                agent.add(new Card({title: `Detalles`,text: `Ver los detalles de ${elementname}`,buttonText: `Ver detalles`,
              	buttonUrl: `${elementname} (${type} : ${elementid})`}));
              }else{agent.add(new Card({title: "Sin imágenes" , text: `No se han encontrado fotos para ${elementname}`}));}
            
            }else{agent.add(new Card({title: "Sin resultados" , text: `No se han encontrado resultados para ${medianame}. Vuelve a intentarlo`}));}
          }
         });
      }else{agent.add(new Card({title: "Sin resultados" , text: `No se han encontrado resultados para ${medianame}. Vuelve a intentarlo`}));}
    });
  }
  
  /*Movie Info: Budget*/
  function handleSearchMovieBudget(){
    var medianame =agent.parameters.medianame;
    var auxname = medianame.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    var arrayName = auxname.split(" ");
    var queryName = arrayName.join('-');
    return axios.get(`${endpoint}/search/multi?api_key=${tmdbKey}&query=${queryName}&page=1&include_adult=false&language=es`)
      .then((result)=>{
     if(result.data.results.length>0){
     var element = result.data.results[0];
     var type = element.media_type;
     var elementId= element.id;
     var elementName = type=="tv"?element.name:element.title;
     var posterPath = element.backdrop_path==null?"":imgPth+element.backdrop_path;
     if(type=="movie"){
       return axios.get(`${endpoint}/movie/${elementId}?api_key=${tmdbKey}&language=es`)
        .then((movie)=>{
         if(movie!=null){
         var media = movie.data;
         var moviename = media.title;
         var countrycode=null;
         media.production_countries.map((country)=>{
           if(country.iso_3166_1=="US"){
             countrycode=country.iso_3166_1;
           }
         });
         var code= countrycode==null?media.production_countries[0].iso_3166_1:null;
         countrycode = code==null?countrycode:code;
         var coin = cc.code(currency[countrycode]).currency;
         var cointranslation;
         if(coin.includes("Dollar")){cointranslation="dólares";}
           else{
             if(coin=="Euro"){cointranslation="euros";}
             else{
               if(coin.includes("Pound")){cointranslation="libras";}
               else{
                 if(coin.includes("Yuan")){cointranslation="yuanes";}
                 else{
                   if(coin.includes("Peso")){cointranslation="pesos";}
                   else{
                     cointranslation=coin;
                   }
                 }
               }
             }
           }
         var budget = media.budget;
         var aux =d3.format("~s")(budget);
      	 var unit = aux.substr(aux.length - 1);
         var budgetunit;
         if(unit=="k"){budgetunit="mil";}
         if(unit=="M"){budgetunit="millones";}
         var parsebudget =aux.substring(0, aux.length - 1);
         if(budget>0){
           agent.add(new Card({title:`Presupuesto de ${elementName}`,imageUrl:posterPath,text:`El presupuesto de la película es ${parsebudget} ${budgetunit} de ${cointranslation}`,
           buttonText:`Ver detalles`,buttonUrl:`${elementName} (movie : ${elementId})`}));
         }else{agent.add(new Card({title:`Presupuesto de ${elementName}`, text:`No está registrado el presupuesto de la película.`, imageUrl:posterPath,
               buttonText:`Ver detalles`,buttonUrl:`${elementName} (movie : ${elementId})`}));}
         }else{agent.add(new Card({title: "Sin resultados" , text: `No se han encontrado resultados para ${elementName}. Vuelve a intentarlo`}));}
       });
     }else{
       if(type=="tv"){
         agent.add(new Card({title:`${elementName} es una serie`,imageUrl:posterPath, text:`Prueba a buscar por temporadas`}));
       }else{agent.add(new Card({title: "Sin resultados" , text: `No se han encontrado resultados para ${medianame}. Vuelve a intentarlo`}));}
     }
    }else{agent.add(new Card({title: "Sin resultados" , text: `No se han encontrado resultados para ${medianame}. Vuelve a intentarlo`}));}
   });   
  }
  
  /*Movie Info: Revenue*/
  function handleSearchMovieRevenue(){
    var medianame =agent.parameters.medianame;
    var auxname = medianame.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    var arrayName = auxname.split(" ");
    var queryName = arrayName.join('-');
    return axios.get(`${endpoint}/search/multi?api_key=${tmdbKey}&query=${queryName}&page=1&include_adult=false&language=es`)
      .then((result)=>{
      if(result.data.results.length>0){
     var element = result.data.results[0];
     var type = element.media_type;
     var elementId= element.id;
     var elementName = type=="tv"?element.name:element.title;
     var posterPath = imgPth+element.backdrop_path;
     if(type=="movie"){
       return axios.get(`${endpoint}/movie/${elementId}?api_key=${tmdbKey}&language=es`)
        .then((movie)=>{
         if(movie!=null){
         var media = movie.data;
         var revenue = media.revenue;
         var aux =d3.format("~s")(revenue);
         var parserevenue =aux.substring(0, aux.length - 1);
      	 var unit = aux.substr(aux.length - 1);
         var revenueunit;
         if(unit=="k"){revenueunit="mil";}
         if(unit=="M"){revenueunit="millones";}
         if(unit=="G"){revenueunit="centenas de millón";}
       	 var countrycode=null;
         media.production_countries.map((country)=>{
           if(country.iso_3166_1=="US"){
             countrycode=country.iso_3166_1;
           }
         });
         var code= countrycode==null?media.production_countries[0].iso_3166_1:null;
         countrycode = code==null?countrycode:code;
         var coin = cc.code(currency[countrycode]).currency;
         var cointranslation;
         if(coin.includes("Dollar")){cointranslation="dólares";}
           else{
             if(coin=="Euro"){cointranslation="euros";}
             else{
               if(coin.includes("Pound")){cointranslation="libras";}
               else{
                 if(coin.includes("Yuan")){cointranslation="yuanes";}
                 else{
                   if(coin.includes("Peso")){cointranslation="pesos";}
                   else{
                     cointranslation=coin;
                   }
                 }
               }
             }
           } 
         if(revenue>0){
           agent.add(new Card({title:`Ingresos de ${elementName}`,imageUrl:posterPath,text:`Los ingresos de la película ${elementName} son de ${parserevenue} ${revenueunit} de ${cointranslation}`,
            buttonText:`Ver detalles`,buttonUrl:`${elementName} (movie : ${elementId})`}));
         }else{
            agent.add(new Card({title:`Ingresos de ${elementName}`,imageUrl:posterPath,text:`Los ingresos de la película ${elementName} no están registrados.`,
            buttonText:`Ver detalles`,buttonUrl:`${elementName} (movie : ${elementId})`}));
         }
         }else{agent.add(new Card({title: "Sin resultados" , text: `No se han encontrado resultados para ${medianame}. Vuelve a intentarlo`}));}
       });
     }else{
       if(type=="tv"){
         agent.add(new Card({title:`${elementName} es una serie`,imageUrl:posterPath, text:`Prueba a buscar por temporadas`}));
       }else{agent.add(new Card({title: "Sin resultados" , text: `No se han encontrado resultados para ${medianame}. Vuelve a intentarlo`}));}
     }
    }else{agent.add(new Card({title: "Sin resultados" , text: `No se han encontrado resultados para ${medianame}. Vuelve a intentarlo`}));}
    });
  }
  
  /*Tv Show Info: Season Details*/
  function handleSearchTvShowSeasonInfo(){
    var medianame =agent.parameters.medianame;
    var auxname = medianame.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    var arrayName = auxname.split(" ");
    var queryName = arrayName.join('-');
    var seasonNumber = agent.parameters.seasonNumber;
    return axios.get(`${endpoint}/search/tv?api_key=${tmdbKey}&language=es&page=1&query=${queryName}&include_adult=false`)
        .then((result)=>{
      if(result.data.results.length>0){
      var element = result.data.results[0];
      var showId = element.id;
      var showName = element.name;
      return axios.get(`${endpoint}/tv/${showId}/season/${seasonNumber}?api_key=${tmdbKey}&language=es`)
        .then((season)=>{
        if(season!=null){
        var numberEpisodes = 0;
        season.data.episodes.map((episode)=>{numberEpisodes++;});
        var cardText = "";
        if(season.data.air_date){
        cardText="Fecha de primera emisión: "+season.data.air_date+" \n "+
            "Número de episodios: "+numberEpisodes+" \n "+
            "Resumen de la temporada: "+season.data.overview;
          var posterPath=imgPth+season.data.poster_path;
          agent.add(new Card({title: showName+" (Temporada "+seasonNumber+")",imageUrl: posterPath,text: cardText}));
          for(var i=1;i<numberEpisodes;i++){
            agent.add(new Card({title:`Episodio ${i}`, text:`Detalles del episodio ${i}`,
            buttonText:`Ver Detalles`,buttonUrl:`Episodio ${i} de la temporada ${seasonNumber} de la serie ${showName}`}));
          }
        }else{ cardText="La temporada aún no ha sido estrenada.";}
        agent.add(new Card({title: `Ver temporadas`,text: `Volver a las temporadas de ${showName}`,buttonText: `Ver temporadas`,buttonUrl: `Temporadas de ${showName}`}));
      	agent.add(new Card({title: `Detalles`,text: `Volver a los detalles de ${showName}`,buttonText: `Ver detalles`,buttonUrl: `${showName} (tv : ${showId})`}));
        }else{agent.add(new Card({title: "Sin resultados" , text: `No se han encontrado resultados para ${medianame}. Vuelve a intentarlo`}));}
      });
      }else{agent.add(new Card({title: "Sin resultados" , text: `No se han encontrado resultados para ${medianame}. Vuelve a intentarlo`}));}
    });
  }
  
  /*Tv Show Info: Episode Details*/
  function handleSearchTvShowEpisodeInfo(){
    var medianame =agent.parameters.medianame;
    var auxname = medianame.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    var arrayName =auxname.split(" ");
    var queryName = arrayName.join('-');
    var seasonNumber = agent.parameters.seasonNumber;
    var episodeNumber = agent.parameters.episodeNumber;
    return axios.get(`${endpoint}/search/tv?api_key=${tmdbKey}&language=es&page=1&query=${queryName}&include_adult=false`)
    .then((result)=>{
      if(result.data.results.length>0){
      var element = result.data.results[0];
      var showId = element.id;
     return axios.get(`${endpoint}/tv/${showId}/season/${seasonNumber}/episode/${episodeNumber}?api_key=${tmdbKey}&language=es`)
     .then((episode)=>{
       if(episode!=null){
        var title = episode.data.name;
        var cardText ="Fecha de emisión: "+episode.data.air_date+" \n "+
            "Número de episodio: "+episode.data.episode_number+" \n "+
            "Número de temporada: "+episode.data.season_number+" \n "+
            "Puntuación: "+episode.data.vote_average+" \n "+
            "Resumen: "+episode.data.overview;
        var posterPath=imgPth+episode.data.still_path;
        agent.add(new Card({title: title,imageUrl: posterPath,text: cardText}));
        agent.add(new Card({title: `Ver temporadas`,text: `Volver a las temporadas de ${medianame}`,
        buttonText: `Ver temporadas`,buttonUrl: `Temporadas de ${auxname}`}));
        agent.add(new Card({title: `Ver temporada ${episode.data.season_number}`,text: `Volver a los episodios de la temporada ${episode.data.season_number} de ${medianame}`,
        buttonText: `Ver temporada ${episode.data.season_number}`,buttonUrl: `Temporada ${episode.data.season_number} de ${auxname}`}));
       }else{agent.add(new Card({title: "Sin resultados" , text: `No se han encontrado resultados para ${medianame}. Vuelve a intentarlo`}));}
      });
      }else{agent.add(new Card({title: "Sin resultados" , text: `No se han encontrado resultados para ${medianame}. Vuelve a intentarlo`}));}
    });
  }
   
/***********************************************/
/************SHOWTIMES***********/
  /*Showtimes searching type by CITY*/
  /*Showtimes: Getting cinemas*/
  function handleSearchIntroduceCity(){
    var city = agent.parameters.city.toLowerCase();
    var password = agent.parameters.password;
    var username = agent.parameters.username;
    var alias = agent.parameters.alias;
    agent.add(`${city}`);
    agent.setContext({ "name": "introduce_city_followup","lifespan":1,"parameters":{"city":city,"password":password, "username":username,"alias":alias}});  
    return axios.get(`https://www.abc.es/play/cine/cartelera/${city}/`)
      .then((response)=>{
      const $ = cheerio.load(response.data);
      var cinemas = $('span.contenedor').find('main').find('span.seccion.clear.cine')
      .find('span.tarjeta.w4').find('ul.cartelera-listado').children();
      cinemas.each((index,element)=>{
        var locality = $(element);
        var localityName = locality.find('h3').find('a').attr('title').toLowerCase();
        if(localityName.trim()==city.trim()){
        var cinemasInLocality = locality.find('ul.listado-cines').children();
        cinemasInLocality.each((ind,elm)=>{
          var cinemaLink = $(elm).find('a');
          var cinemaRef = cinemaLink.attr('href');
          var cinemaname = cinemaLink.attr('title');
          agent.add(`${cinemaname}`);
          agent.add(`${cinemaRef}`);
          agent.add(new Card({title: `${cinemaname}`,text:`Cine`,
          buttonText: `Ver cartelera`, buttonUrl: `(${cinemaRef} en el cine ${cinemaname})`}));
        });
        }
      });
    });
  }
  
  /*Showtimes: Getting Movies*/
  function handleSearchIntroduceCinema(){
    var city = agent.parameters.city;
    var cinemaLink = agent.parameters.cinemalink;
    var cinemaname = agent.parameters.cinemaname;
    agent.add(`CINEMA: ${cinemaname}`);
    var cinemaPath = abcPth+cinemaLink;
    return axios.get(`${cinemaPath}`)
      .then((response)=>{
      const $ = cheerio.load(response.data);
      var mainDiv = $('span.contenedor').find('main').find('span.seccion.clear.cine');
      var data = mainDiv.find('span.tarjeta.w6').find('dl.datos-cine').children();
      var movies = mainDiv.find('span.tarjeta.w4').find('span.caja-cartelera').children();      
      var cardText = "";
      data.each((ind,elm)=>{
       cardText = cardText+$(elm).text()+"\n";
      });
      agent.add(new Card({title: "Cartelera",text:cardText}));
      movies.each((ind,elm)=>{
        var image = $(elm).find('img').attr('data-src');
        var movieinfo = $(elm).find('span');
        var movietitle = movieinfo.find('h3').text();
        var moviedata = movieinfo.find('dl.datos-pelicula').children();
     	var moviecast = movieinfo.find('ul.reparto').children();
        var movietext = "";
        moviedata.each((id,el)=>{
          movietext = movietext+$(el).text()+"\n";
        });
        movietext=movietext+"\nReparto: \n";
        moviecast.each((id,el)=>{
          var personlink = $(el).find('a').attr('title');
          movietext = movietext+personlink+"\n";
        });
        agent.add(new Card({title: `Película: ${movietitle}`,text:`${movietext}`,imageUrl:image,
         buttonText: `Ver horarios `, buttonUrl: `horarios ${movietitle}`}));
      });
    });
  }
  
  /*Showtimes at a cinema*/
  function handleMovieShowtimesAtCinema(){
    var city = agent.parameters.city;
    var cinemaLink = agent.parameters.cinemalink;
    agent.add(`${cinemaLink}`);
    var cinemaPath = abcPth+cinemaLink;
    var moviename = agent.parameters.moviename;
    var arraydates = [];
    return axios.get(`${cinemaPath}`)
      .then((response)=>{
      const $ = cheerio.load(response.data);
      var mainDiv = $('span.contenedor').find('main').find('span.seccion.clear.cine');
      var movies = mainDiv.find('span.tarjeta.w4').find('span.caja-cartelera').children();
      var dates = mainDiv.find('span.tarjeta.w4').find('div.pestanas-cartelera').children();
      dates.each((ind, elm)=>{
        var date = $(elm).text();
      	arraydates.push(date);
      });
      var count = 0;
      movies.each((ind,elm)=>{
        var movieinfo = $(elm).find('span');
        var movietitle = movieinfo.find('h3').text();
        var parsemovietitle = movietitle.toLowerCase();
        if(parsemovietitle.trim() == moviename.toLowerCase().trim()){
            agent.add(`${movietitle}`);
          	var date = arraydates[count];
          	count++;
          	var showtimes = movieinfo.find('ul.pases').children();
          	var textshowtimes = "";
          	showtimes.each((i,el)=>{
              var showtime = $(el).find('span').text();
              agent.add(new Card({title: `Sesion `,text:`Hora: ${showtime}`,
       			buttonText:`Comprar entrada`,buttonUrl:`Comprar entrada ${movietitle} horario ${showtime}`}));
            });
          //agent.add(new Card({title: `Horarios para ${date}`,text:`${textshowtimes}`})); 
        }
    });
   });
  }
  
  /***********************************************/ 
  /*Showtimes Searching Type BY MOVIE*/
  /*Introduce a movie to find cinemas*/
  function handleSearchIntroduceMovie(){
    var moviename = agent.parameters.moviename;
    var city = agent.parameters.city;
    agent.add(`Pelicula: ${moviename}`);
    return axios.get(`${abcPth}/play/cine/cartelera/${city}/`)
      .then((response)=>{
      const $ = cheerio.load(response.data);
      var movies = $('span.contenedor').find('main').find('span.seccion.clear.cine')
        .find('span.tarjeta.w4').find('span.grid-peliculas')
        .find('ul.mosaico.cuatro.blanco.peliculas.clear').children();
      movies.each((ind, elm)=>{
        var movielink = $(elm).find('h3').find('a');
        var moviereference = movielink.attr('href');
        var element = movielink.attr('title').toLowerCase().trim();
        if(element == moviename.toLowerCase().trim()){
           agent.add(`Print ${element}`);
           agent.add(`Reference: ${moviereference}`);
          	var arrayref = moviereference.split('/');
          	var aux = arrayref[arrayref.length-2].split('-');
          	var movieid = aux[aux.length-1];
          	agent.add(`ID: ${movieid}`);
          	agent.setContext({ "name": "introduce_movie_followup","lifespan":1,"parameters":{"movieid":movieid}});
        	agent.add(new Card({title: `¿Para qué ciudad quieres buscar?`}));
        }
      });
    });
  }
  
  /*Introduce city name to search movie showtimes*/
  function handleSearchIntroduceCityForMovie(){
    var cityname = agent.parameters.cityname;
    var parsecity = cityname.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    var movieid = agent.parameters.movieid;
    var path = abcPth+"/play/cine/cartelera/cines-donde-ver/pelicula-"+movieid+"/"+parsecity;
    return axios.get(`${path}`).then((response)=>{
      const $ = cheerio.load(response.data);
      var cinemas = $('span.contenedor').find('main')
      .find('span.seccion.clear.cine')
      .find('span.tarjeta.w4').children('article');
      cinemas.each((ind, elm)=>{
        var section = $(elm).find('span.info');
        var cinemaname = section.find('h3.nombre-pelicula').find('a').attr('title');
        var moviename = section.find('h3.nombre-pelicula').text();
        var showtimes = section.find('ul.pases').children();
        var shwtlist = "";
        showtimes.each((i, el)=>{
          var showtime = $(el).find('span').text();
          shwtlist = shwtlist+showtime+" ";
        });
	 	agent.add(new Card({title: `Horarios en ${cinemaname}`,text:`${shwtlist}`})); 
      });
    });
  }
  
  /****AUXILIAR FUNCTIONS****/
  
  /*Get differences between strings*/
  function getDifference(a, b){
    var i = 0;
    var j = 0;
    var result = "";
    while (j < b.length){
      if (a[i] != b[j] || i == a.length)
        result += b[j];
      else
        i++;
        j++;
    }
    return result;
  }
  
  /***********************************************/
  /*BUY TICKETS*/
  /*Choosing Showtime Row*/
  function handleChooseShowtimeRow(){
    var movietitle = agent.parameters.movietitle.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    var moviequery = movietitle.split(" ").join('-');
    var city = agent.parameters.city;
    var cinemaname = agent.parameters.cinemaname;
    var shwt = agent.parameters.showtime;
    return axios.get(`https://cine.entradas.com/p/${moviequery}`).then((response)=>{
      var found=false;
      const $ = cheerio.load(response.data);
      var cinemas = $('div.page.page--portal').find('article')
      .find('section.page__wrapper.page__wrapper--light')
      .find('div.page__content').find('div.shows')
      .find('div.shows__view.shows__view--days')
      .find('ul.ui-list.ui-list--shows.is-active')
      .children('li.grid.grid--align-center');
      var parsecinema = cinemaname.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
      var shwtlink;
      cinemas.each((i,element)=>{
        var cinemaOriginalName = $(element).find('div.grid__col-12.grid__col-md-3.grid__cell')
        .find('a').text().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
       if(parsecinema.includes(cinemaOriginalName)||
          cinemaOriginalName.includes(parsecinema)||
          getDifference(parsecinema,cinemaOriginalName)=="cines"||
          getDifference(parsecinema,cinemaOriginalName)=="3d"||
          getDifference(parsecinema,cinemaOriginalName)=="premium"){
          var showtimes = $(element).find('ul.schedule__times.grid__col-12.grid__col-md-9').children();
       	  showtimes.each((ind,elm)=>{
            var showtime = $(elm);
            var shwtime = showtime.find('a').text().trim();
            if(shwtime==shwt){
              found=true;
              shwtlink = ticketsPth+showtime.find('a').attr('href');
              agent.add(`${shwtlink}`);
              agent.add(`${found}`);
            }
          });
       }
      });
      agent.add(`${shwtlink}`);
      return axios.get(`${shwtlink}`).then((result)=>{
        const $ = cheerio.load(result.data);
        console.log("DATA:: "+$('div.page.page--portal')
        .find('div.page__wrapper.page__wrapper--grow.page__wrapper--light')
        .find('div.page__content.grid')
        .find('div.grid__col-12.u-no-overflow')
        .find('div.panel-panes')
        .find('section.panel-pane.panel-pane--seats.is-active').html());
        /*.find('div.panel-pane__content')
        .find('div.seatplan.auditorium-6533.flex.flex-wrap')
        .find('div.w-full').html());*/
        
        if(!found){
          agent.add(`No se han encontrado resultados para dicha sesión en ${cinemaname}`);
        }
     });
    });
  }
  
  /*Request payment*/
  function handleTicketPayment(){
    var username = agent.parameters.username;
    var password = agent.parameters.password;
    var alias = agent.parameters.alias;
    var movietitle = agent.parameters.movietitle;
    var showtime = agent.parameters.showtime;
    let ref = database.ref("users");
    //Payment???
     return ref.once("value").then((snapshot) =>{
       var paymentid =snapshot.child(`${username}/paymentid`).val();
       var email =snapshot.child(`${username}/email`).val();
       agent.add(`${email}`);
       if(paymentid==null){
         agent.add(`Introduce el número de la tarjeta`);
         agent.setContext({name:'creating_payment',lifespan:1,parameters:{"username":username,"password":password,"alias":alias,"email":email,"movietitle":movietitle,"showtime":showtime}});
       }else{
         agent.add(`Entonces, ¿Quieres proceder al pago?`);
         agent.setContext({name:'create_payment_followup',lifespan:1,parameters:{"username":username,"password":password,"alias":alias,"email":email,"movietitle":movietitle,"showtime":showtime}});
       }
     });
  }
 
  /*Create Payment Method*/
  function handleCreatePayment(){
    var cardnumber = agent.parameters.cardnumber;
    var email = agent.parameters.email;
    var showtime = agent.parameters.showtime;
    var movietitle = agent.parameters.movietitle;
    var alias = agent.parameters.alias;
    var username = agent.parameters.username;
    agent.add(`Tu método de pago se ha añadido correctamente. ¿Quieres proceder al pago?`);
    stripe.paymentMethods.create({
      type: 'card',
      card: {
        number: `${cardnumber}`,
        exp_month: 9,
        exp_year: 2021,
        cvc: '314'
      }
    }).then(payment =>{
      generalRef.child(username).update({
        paymentid: payment.id
      });
      return stripe.customers.create({
        email:`${email}`,
        description: `Customer: ${alias}`,
        payment_method: payment.id
      }).then((customer)=>{
        generalRef.child(username).update({
          customerid: customer.id
        });
      });
    }).catch(error => console.error(error));
  }
  
  /*Payment method registered, proceed to payment*/
  function handleProceedToPayment(){
    let ref = database.ref("users");
    var username = agent.parameters.username;
    agent.add(`El pago se ha efectuado correctamente`);
    return ref.once("value").then((snapshot) =>{
      var customerid =snapshot.child(`${username}/customerid`).val();
      var paymentid =snapshot.child(`${username}/paymentid`).val();
      stripe.paymentIntents.create({
        amount: 10000,
        currency: 'eur',
        confirm: true,
        customer:customerid,
        payment_method:paymentid,
      }).catch(error => console.error(error));
    });
  }
  
  /******* MAPING INTENTS *******/
  let intentMap = new Map();
  intentMap.set('GetUserUsernameIntent', handleUsernameRegistered);
  intentMap.set('GetUserPasswordIntent', handleGetPassword);
  intentMap.set('LoginIntroducePasswordIntent', handleLoginPassword);
  intentMap.set('CorrectAccessIntent', handleCorrectAccess);
  intentMap.set('LoginFirstActionIntent', handleUserAlias);
  intentMap.set('LoginFirstEmailIntent', handleUserEmail);
  intentMap.set('SearchInfoIntent', handleMediaSearch);
  intentMap.set('ViewMediaDetails', handleViewMediaDetails);
  intentMap.set('SearchNowShowing', handleNowShowing);
  intentMap.set('SearchMostPopularMovies', handleMostPopularMovies);
  intentMap.set('SearchTopRatedMovies', handleTopRatedMovies);
  intentMap.set('SearchMediaDate', handleSearchMediaDate);
  intentMap.set('SearchMediaRating', handleSearchMediaRating);
  intentMap.set('SearchMediaOverview', handleSearchMediaOverview);
  intentMap.set('SearchMediaCast', handleMediaCast);
  intentMap.set('SearchMediaDirectors', handleSearchMediaDirectors);
  intentMap.set('SearchMediaLanguage', handleSearchMediaLanguage);
  intentMap.set('SearchTvSeasons', handleSearchTvSeasons);
  intentMap.set('SearchNetworks', handleSearchNetworks);
  intentMap.set('SearchMediaGenres', handleSearchMediaGenres);
  intentMap.set('SearchMediaOriginalTitle', handleSearchMediaOriginalTitle);
  intentMap.set('SearchMediaVideos', handleSearchMediaVideos);
  intentMap.set('SearchMediaOfficialPage', handleSearchMediaOfficialPage);
  intentMap.set('SearchSimilarMedia', handleSearchSimilarMedia);
  intentMap.set('SearchMediaIsAdult', handleSearchMediaIsAdult);
  intentMap.set('SearchPersonPopularMovies', handleSearchPersonPopularMovies);
  intentMap.set('SearchPersonPopularTvShows', handleSearchPersonPopularTvShows);
  intentMap.set('SearchMediaReviews', handleSearchMediaReviews);
  intentMap.set('SearchPersonBiography', handleSearchPersonBiography);
  intentMap.set('SearchPersonBirthdate', handleSearchPersonBirthdate);
  intentMap.set('SearchPersonRoleInMedia', handleSearchPersonRoleInMedia);
  intentMap.set('SearchMovieDuration', handleSearchMovieDuration);
  intentMap.set('SearchMediaImages', handleSearchMediaImages);
  intentMap.set('SearchMovieBudget', handleSearchMovieBudget);
  intentMap.set('SearchMovieRevenue', handleSearchMovieRevenue);
  intentMap.set('SearchMostPopularTvShows', handleSearchMostPopularTvShows);
  intentMap.set('SearchGenreMostPopularMovies', handleSearchGenreMostPopularMovies);
  intentMap.set('SearchYearMostPopularMovies', handleSearchYearMostPopularMovies);
  intentMap.set('SearchGenreMostPopularShows', handleSearchGenreMostPopularShows);
  intentMap.set('SearchTopRatedTvShows', handleSearchTopRatedTvShows);
  intentMap.set('SearchTvShowSeasonInfo', handleSearchTvShowSeasonInfo);
  intentMap.set('SearchTvShowEpisodeInfo', handleSearchTvShowEpisodeInfo);
  intentMap.set('SearchGenreYearMostPopularMovies', handleSearchGenreYearMostPopularMovies);
  intentMap.set('SearchYearActorMostPopularMovies', handleSearchYearActorMostPopularMovies);
  intentMap.set('SearchGenreActorMostPopularMovies', handleSearchGenreActorMostPopularMovies);
  intentMap.set('IntroduceCity', handleSearchIntroduceCity);
  intentMap.set('IntroduceCinema', handleSearchIntroduceCinema);
  intentMap.set('MovieShowtimesAtCinema', handleMovieShowtimesAtCinema);
  intentMap.set('IntroduceMovie', handleSearchIntroduceMovie);
  intentMap.set('IntroduceCityForMovie', handleSearchIntroduceCityForMovie);
  intentMap.set('TicketPayment',handleTicketPayment);
  intentMap.set('CreatePayment',handleCreatePayment);
  intentMap.set('ProceedToPayment',handleProceedToPayment);
  intentMap.set('ChooseShowtimeRow',handleChooseShowtimeRow);
  agent.handleRequest(intentMap);
});
