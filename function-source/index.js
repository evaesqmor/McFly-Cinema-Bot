// See https://github.com/dialogflow/dialogflow-fulfillment-nodejs
// for Dialogflow fulfillment library docs, samples, and to report issues
'use strict';
 
//Define Firebase

const functions = require('firebase-functions');
const {Text, Card, WebhookClient, Image, Suggestion, Payload} = require('dialogflow-fulfillment');
const axios = require('axios');
var nodemailer = require('nodemailer');

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
        agent.add(`El usuario ${username} ya existe. Prueba a introducir otro usuario`);
        agent.setContext({ "name": "not_registered_followup","lifespan":1});
      }else {
        agent.add(`Adelante, introduce una contraseña`);
        agent.setContext({ "name": "get_username_followup","lifespan":1,"parameters":{"username":username}});
      }
    });
  }

  /*Registro, guardar usuario en la bdd*/
  function handleGetPassword(){
    const username= agent.parameters.username;
    const password = agent.parameters.password;
    agent.add(`Has sido registrado correctamente, ${username}. ¿Te gustaría logearte?`);
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
        console.log("CONTRASEÑA: ", storedPassword);
        if(password == storedPassword){
          agent.setFollowupEvent({ "name": "correctaccess", "parameters" : { "username": username, "password":password, "alias":alias}});
        }
      }else{
        agent.add(`Lo siento, la contraseña no es correcta. ¿Quieres volver a intentarlo?`);
        agent.setContext({ "name": "registered_followup","lifespan":1});  
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
  
  /*General Info Search*/
  function handleMediaSearch(){
    const medianame = agent.parameters.medianame;
    var arrayName = medianame.split(" ");
    var queryName = arrayName.join('-');
    agent.add(`Resultados para ${medianame}:`);
    
    return axios.get(`https://api.themoviedb.org/3/search/multi?api_key=${tmdbKey}&query=${queryName}&page=1&include_adult=false&language=es`)
      .then((result)=>{
      if(result!=null){
        var count = 0;
        result.data.results.map((media) =>{
          if(count < 10){
            count++;
            var mediaType=media.media_type;
            var title, fullTitle, cardText, posterPath = "";
            if(mediaType=="person"){
              title =`${media.name}`;
              fullTitle = `${count}. ${media.name} (Persona)`;
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
              cardText = cardText!=""?"**Conocido por** :\n"+cardText:cardText;
            }
            if(mediaType=="tv"){
              title =`${media.name}`;
              fullTitle =`${count}. ${media.name} (Serie de televisión})`;
              cardText = "**Nota media:** "+media.vote_average==0+
                "**Fecha de estreno:** "+media.first_air_date+"\n"+
                "**Resumen:\n"+media.overview;
              posterPath = imgPth+media.poster_path;
            }
            
            if(mediaType=="movie"){
              title = `${media.title}`;
              fullTitle = `${count}. ${media.title} (Película)`;
              cardText = "**Nota media:** "+media.vote_average==0+"\n"+
              "**Fecha de estreno:** "+media.release_date+"\n"+
              "**Resumen:** \n"+media.overview;
              posterPath = imgPth+media.poster_path;
            }
            
            agent.add(new Card({
              title: fullTitle,
              imageUrl: posterPath,
              text: cardText
            }));
            agent.add(new Suggestion(`${title} (${mediaType} : ${media.id})`));  
          }
        });
      }
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
             "**Ocupación:** "+result.data.known_for_department+"\n"+
             "**Fecha de nacimiento:** "+result.data.birthday+"\n"+
             "**Fecha de fallecimiento:** "+result.data.deathday+"\n"+
             "**Lugar de nacimiento:** "+result.data.place_of_birth+"\n"+
             "**Biografía:** "+result.data.biography;
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
         "**Puntuación media:** "+result.data.vote_average+"\n"+
         "**Dirigida por:** "+direction+"\n"+
         "**Próximo Episodio:** "+result.data.next_episode_to_air+"\n"+
         "**Total de episodios:** "+result.data.number_of_episodes+"\n"+
         "**Total de temporadas:** "+result.data.number_of_seasons+"\n"+
         "**Fecha de estreno:** "+result.data.first_air_date+"\n"+
         "**Estado actual:** "+result.data.status+"\n"+
         "**Fecha de fin:** "+result.data.last_air_date+"\n"+
         "**Idioma original:** "+result.data.original_language+"\n"+
         "**Géneros:** "+genres+"\n"+    
         "**Resumen:** "+result.data.overview;
       
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
           	"__"+result.data.tagline+"__ \n"+
            "**Puntuación media:** "+result.data.vote_average+"\n"+
           	"**Fecha de estreno:** "+result.data.release_date+"\n"+
            "**Idioma original:** "+result.data.original_language+"\n"+
            "**Estado:** "+result.data.status+"\n"+
            "**Presupuesto:** "+result.data.budget+"\n"+
            "**Recaudado:** "+result.data.revenue+"\n"+
            "**Géneros:** "+genres+"\n"+
            "**Resumen:** "+result.data.overview+"\n";
        
        var posterPath = imgPth+result.data.poster_path;

        agent.add(new Card({
           title: name,
           imageUrl: posterPath,
           text: cardText,
         }));
      });
    }
  }
  
  /*Movies now on cinemas*/
  function handleNowShowing(){
    var mediatype = agent.parameters.mediatype;
    var location = agent.parameters.location;
    
    return axios.get(`https://api.themoviedb.org/3/movie/now_playing?api_key=${tmdbKey}&language=es&page=1`)
        .then((result)=>{

        console.log("RESULTTS",result.data.results[0]);
        result.data.results.map((movie)=>{
          var name= movie.title;

          var cardText=
              "**Puntuación media:** "+movie.vote_average+"\n"+
              "**Fecha de estreno:** "+movie.release_date+"\n"+
              "**Idioma original:** "+movie.original_language+"\n"+
              "**Resumen:** "+movie.overview+"\n";

          var posterPath = imgPth+movie.poster_path;

          agent.add(new Card({
             title: name,
             imageUrl: posterPath,
             text: cardText
           }));
        });
      });
  }
  
  /*Most Popular Movies*/
  function handleMostPopularMovies(){
     return axios.get(`https://api.themoviedb.org/3/movie/popular?api_key=${tmdbKey}&language=es&page=1`)
        .then((result)=>{
       		result.data.results.map((movie)=>{
              var name= movie.title;
              var cardText=
              "**Puntuación media:** "+movie.vote_average+"\n"+
              "**Fecha de estreno:** "+movie.release_date+"\n"+
              "**Idioma original:** "+movie.original_language+"\n"+
              "**Resumen:** "+movie.overview+"\n";
              var posterPath = imgPth+movie.poster_path;
              
             agent.add(new Card({
               title: name,
               imageUrl: posterPath,
               text: cardText
             }));
           });
     });
  }
  
  /*Top Rated Movies*/
  function handleTopRatedMovies(){
     return axios.get(`https://api.themoviedb.org/3/movie/top_rated?api_key=${tmdbKey}&language=es&page=1`)
        .then((result)=>{
       		console.log("RESULTT",result);
       		result.data.results.map((movie)=>{
              var name= movie.title;
              var cardText=
              "**Puntuación media:** "+movie.vote_average+"\n"+
              "**Fecha de estreno:** "+movie.release_date+"\n"+
              "**Idioma original:** "+movie.original_language+"\n"+
              "**Resumen:** "+movie.overview+"\n";
              var posterPath = imgPth+movie.poster_path;
              
             agent.add(new Card({
               title: name,
               imageUrl: posterPath,
               text: cardText
             }));
           });
     });
  }
  
  /*Media Release Date*/
  function handleSearchMediaDate(){
    const medianame = agent.parameters.medianame;
    var arrayName = medianame.split(" ");
    var queryName = arrayName.join('-');
 
    return axios.get(`https://api.themoviedb.org/3/search/multi?api_key=${tmdbKey}&query=${queryName}&page=1&include_adult=false&language=es`)
      .then((result)=>{
      if(result!=null){
        var element = result.data.results[0];
        var mediaType=element.media_type;
        if(mediaType=="tv"){
          var name = element.name;
          var airDate = element.first_air_date;
          agent.add(`La fecha de estreno de la serie ${name} es ${airDate}`);
        }
        
        if(mediaType=="movie"){
          var title = element.title;
          var releaseDate = element.release_date;
          agent.add(`La fecha de estreno de la pelicula ${title} es ${releaseDate}`);
        }
      }
    });
  }
  
  /*Media Rating*/
  function handleSearchMediaRating(){
    const medianame = agent.parameters.medianame;
    var arrayName = medianame.split(" ");
    var queryName = arrayName.join('-');
 
    return axios.get(`https://api.themoviedb.org/3/search/multi?api_key=${tmdbKey}&query=${queryName}&page=1&include_adult=false&language=es`)
      .then((result)=>{
      if(result!=null){
        var element = result.data.results[0];
        var mediaType=element.media_type;
        var rating = element.vote_average;

        if(mediaType=="tv"){
          var name = element.name;
          agent.add(`La puntuación media de la serie ${name} es ${rating}`);
        }
        
        if(mediaType=="movie"){
          var title = element.title;
          agent.add(`La puntuación media de la pelicula ${title} es ${rating}`);
        }
      }
    });
  }
  
  /*Media Review*/
  function handleSearchMediaOverview(){
    const medianame = agent.parameters.medianame;
    var arrayName = medianame.split(" ");
    var queryName = arrayName.join('-');
 
    return axios.get(`https://api.themoviedb.org/3/search/multi?api_key=${tmdbKey}&query=${queryName}&page=1&include_adult=false&language=es`)
      .then((result)=>{
      if(result!=null){
        var element = result.data.results[0];
        var mediaType=element.media_type;
        var overview = element.overview;

        if(mediaType=="tv"){
          var name = element.name;
          agent.add(`Sipnosis de la serie ${name}: ${overview}`);
        }
        
        if(mediaType=="movie"){
          var title = element.title;
          agent.add(`Sipnosis de la película ${title}: ${overview}`);
        }
      }
    });
  }
  
  /*Movie Cast*/
  function handleMovieCast(){
  var medianame =agent.parameters.medianame;
  var arrayName = medianame.split(" ");
  var queryName = arrayName.join('-');
  
    return axios.get(`https://api.themoviedb.org/3/search/movie?api_key=${tmdbKey}&query=${queryName}&page=1&include_adult=false&language=es`)
      .then((result)=>{
      
      var element = result.data.results[0];
      var movieId = element.id;
      
      return axios.get(`https://api.themoviedb.org/3/movie/${movieId}/credits?api_key=${tmdbKey}&language=es`)
      .then((credits)=>{
        var credit = credits.data.cast[0];
        var count = 0;
        credits.data.cast.map((credit) =>{
          if(count<10){
            count++;
            var posterPath =imgPth+credit.profile_path;
            agent.add(new Card({
               title: "Personaje: "+credit.character,
               imageUrl: posterPath,
               text: credit.name}));
          }
        });
      });
    });
  }
  
  /*Series Cast*/
  function handleTvCast(){
    var medianame =agent.parameters.medianame;
    var arrayName = medianame.split(" ");
    var queryName = arrayName.join('-');
  
    return axios.get(`https://api.themoviedb.org/3/search/tv?api_key=${tmdbKey}&query=${queryName}&page=1&include_adult=false&language=es`)
      .then((result)=>{
      
      var element = result.data.results[0];
      var tvId = element.id;
      
      return axios.get(`https://api.themoviedb.org/3/tv/${tvId}/credits?api_key=${tmdbKey}&language=es`)
      .then((credits)=>{
        var credit = credits.data.cast[0];
        var count = 0;
        credits.data.cast.map((credit) =>{
          if(count<10){
            count++;
            var posterPath =imgPth+credit.profile_path;
            agent.add(new Card({
               title: "Personaje: "+credit.character,
               imageUrl: posterPath,
               text: credit.name}));
          }
        });
      });
    }); 
  }
  
  /*Movie Directors*/
  function handleSearchMovieDirectors(){
    var medianame =agent.parameters.medianame;
    var arrayName = medianame.split(" ");
    var queryName = arrayName.join('-');
  
    return axios.get(`https://api.themoviedb.org/3/search/movie?api_key=${tmdbKey}&query=${queryName}&page=1&include_adult=false&language=es`)
      .then((result)=>{
      
      var element = result.data.results[0];
      var movieId = element.id;
      
      return axios.get(`https://api.themoviedb.org/3/movie/${movieId}/credits?api_key=${tmdbKey}&language=es`)
      .then((credits)=>{
        var text = "Los directores de la película "+medianame+" son: ";
        agent.add(`${text}`);
        credits.data.crew.map((credit) =>{
          if(credit.job=="Director"){
            var name = credit.name;
            agent.add(`${name}`);
          }
        });
      });
    });
  }
  
  /*Tv Directors*/
  function handleSearchTvDirectors(){
    var medianame =agent.parameters.medianame;
    var arrayName = medianame.split(" ");
    var queryName = arrayName.join('-');
    return axios.get(`https://api.themoviedb.org/3/search/tv?api_key=${tmdbKey}&query=${queryName}&page=1&include_adult=false&language=es`)
      .then((result)=>{
      
      var element = result.data.results[0];
      var tvId = element.id;
      
      return axios.get(`https://api.themoviedb.org/3/tv/${tvId}/credits?api_key=${tmdbKey}&language=es`)
      .then((credits)=>{
        agent.add(`Los directores de la serie ${medianame} son: `);
        credits.data.crew.map((credit) =>{
          if(credit.job=="Director"||credit.job=="Executive Producer"){
            var name = credit.name;
            agent.add(`${name}`);
          }
        });
      });
    });
  }
  
  /*Media Language*/
  function handleSearchMediaLanguage(){
    const medianame = agent.parameters.medianame;
    var arrayName = medianame.split(" ");
    var queryName = arrayName.join('-');
 
    return axios.get(`https://api.themoviedb.org/3/search/multi?api_key=${tmdbKey}&query=${queryName}&page=1&include_adult=false&language=es`)
      .then((result)=>{
      if(result!=null){
        var element = result.data.results[0];
        var mediaType=element.media_type;
        var originalLanguage = element.original_language;

        if(mediaType=="tv"){
          var name = element.name;
          agent.add(`El idioma original de la serie ${name} es ${originalLanguage}`);
        }
        
        if(mediaType=="movie"){
          var title = element.title;
          agent.add(`El idioma original de la película ${title} es ${originalLanguage}`);
        }
      }
    });
  }
  
  function handleSearchTvSeasons(){
    var medianame =agent.parameters.medianame;
    var arrayName = medianame.split(" ");
    var queryName = arrayName.join('-');
    
    return axios.get(`https://api.themoviedb.org/3/search/multi?api_key=${tmdbKey}&query=${queryName}&page=1&include_adult=false&language=es`)
      .then((result)=>{
       
      var element = result.data.results[0];
      var tvId = element.id;
    
     return axios.get(`https://api.themoviedb.org/3/tv/${tvId}?api_key=${tmdbKey}&language=en-US`)
      .then((series)=>{
       console.log("SERIES",series);
       var name = series.data.name;
       var numberSeasons = series.data.number_of_seasons;
       var numberEpisodes = series.data.number_of_episodes;
       agent.add(`El número de temporadas de la serie ${name} es ${numberSeasons}. En total tiene ${numberEpisodes} episodios.`);
     });
     });
  }
  
  function handleSearchTvNetworks(){
    
    var medianame =agent.parameters.medianame;
    var arrayName = medianame.split(" ");
    var queryName = arrayName.join('-');
    
    return axios.get(`https://api.themoviedb.org/3/search/multi?api_key=${tmdbKey}&query=${queryName}&page=1&include_adult=false&language=es`)
      .then((result)=>{
      
      var element = result.data.results[0];
      var tvId = element.id;
       return axios.get(`https://api.themoviedb.org/3/tv/${tvId}?api_key=${tmdbKey}&language=en-US`)
      .then((series)=>{
         var name = series.data.name;
         agent.add(`La serie ${name} se puede ver en las plataformas: `);
         series.data.networks.map((network)=>{
           var networkName = network.name;
           var networkLogo = imgPth+network.logo_path;
           agent.add(new Card({
             title: networkName,
             imageUrl: networkLogo, 
           }));
         });
       });
    });
  }
  
  function handleSearchMovieGenres(){
    
    var medianame =agent.parameters.medianame;
    var arrayName = medianame.split(" ");
    var queryName = arrayName.join('-');
    
   return axios.get(`https://api.themoviedb.org/3/search/movie?api_key=${tmdbKey}&query=${queryName}&page=1&include_adult=false&language=es`)
      .then((result)=>{
     
     var element = result.data.results[0];
     var movieId= element.id;
    
     return axios.get(`https://api.themoviedb.org/3/movie/${movieId}?api_key=${tmdbKey}&language=es`)
      .then((movie)=>{
       
       agent.add(`Los generos de la película ${movie.data.title} son: `);
       movie.data.genres.map((genre)=>{
         agent.add(`${genre.name}`);
       });
     });
     });
  }
  
  function handleSearchTvGenres(){
    var medianame =agent.parameters.medianame;
    var arrayName = medianame.split(" ");
    var queryName = arrayName.join('-');
    
   return axios.get(`https://api.themoviedb.org/3/search/tv?api_key=${tmdbKey}&query=${queryName}&page=1&include_adult=false&language=es`)
      .then((result)=>{
     
     var element = result.data.results[0];
     var tvId= element.id;
    
     return axios.get(`https://api.themoviedb.org/3/tv/${tvId}?api_key=${tmdbKey}&language=es`)
      .then((series)=>{
       
       agent.add(`Los generos de la serie ${series.data.name} son: `);
       series.data.genres.map((genre)=>{
         agent.add(`${genre.name}`);
       });
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
  intentMap.set('ViewMediaDetails', handleViewMediaDetails);
  intentMap.set('SearchNowShowing', handleNowShowing);
  intentMap.set('SearchMostPopularMovies', handleMostPopularMovies);
  intentMap.set('SearchTopRatedMovies', handleTopRatedMovies);
  intentMap.set('SearchMediaDate', handleSearchMediaDate);
  intentMap.set('SearchMediaRating', handleSearchMediaRating);
  intentMap.set('SearchMediaOverview', handleSearchMediaOverview);
  intentMap.set('SearchMovieCast', handleMovieCast);
  intentMap.set('SearchTvCast', handleTvCast);
  intentMap.set('SearchMediaLanguage', handleSearchMediaLanguage);
  intentMap.set('SearchMovieDirectors', handleSearchMovieDirectors);
  intentMap.set('SearchTvDirectors', handleSearchTvDirectors);
  intentMap.set('SearchTvSeasons', handleSearchTvSeasons);
  intentMap.set('SearchTvNetworks', handleSearchTvNetworks);
  intentMap.set('SearchMovieGenres', handleSearchMovieGenres);
  intentMap.set('SearchTvGenres', handleSearchTvGenres);
  agent.handleRequest(intentMap);
});
