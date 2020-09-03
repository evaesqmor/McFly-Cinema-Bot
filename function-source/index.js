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
  var endpoint = "https://api.themoviedb.org/3";
 
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
        agent.add(`Adelante, introduce una contraseña`);
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
  
  /*First Access Action*/
  function handleCorrectAccess(){
    const alias= agent.parameters.alias;
    if(alias == ""){
      agent.add(`¡Bienvenido!, ya que la primera vez que accedes, ¿cómo te gustaría que te llamase?`);
    }else{
        agent.add(`Buenas ${alias}, ¿qué te gustaría hacer?`);
    }
  }
  
  /*Storing the user's alias*/
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
  
  /*******SEARCHING CONTENTS*******/
  /*General Info Search: Movies, Shows and People. Displaying basic info*/
  function handleMediaSearch(){
    const medianame = agent.parameters.medianame;
    var arrayName = medianame.split(" ");
    var queryName = arrayName.join('-');
    agent.add(`Resultados para ${medianame}:`);
    return axios.get(`${endpoint}/search/multi?api_key=${tmdbKey}&query=${queryName}&page=1&include_adult=false&language=es`)
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
              fullTitle =`${count}. ${media.name} (Serie de televisión)`;
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
  
  /*Display details: Visualize the details of a movie, show or person*/
  function handleViewMediaDetails(){
    var mediaelement = agent.parameters.mediaelement;
    var mediatype = agent.parameters.mediatype;
    var mediaid = agent.parameters.mediaid;
    if(mediatype=="person"){
       return axios.get(`${endpoint}/person/${mediaid}?api_key=${tmdbKey}&language=es`)
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
       return axios.get(`${endpoint}/tv/${mediaid}?api_key=${tmdbKey}&language=es`)
      .then((result)=>{
         var name = result.data.name;
         var posterPath = imgPth+result.data.poster_path;
         var genres = "";
         var direction = "";
         var inProduction = result.data.in_production;
         result.data.genres.map((genre) => {
          genres = genres+genre.name+"|";
         });
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
      return axios.get(`${endpoint}/movie/${mediaid}?api_key=${tmdbKey}&language=es`)
      .then((result)=>{
        var name= result.data.title;
        var genres = "";
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
    
    return axios.get(`${endpoint}/movie/now_playing?api_key=${tmdbKey}&language=es&page=1`)
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
     return axios.get(`${endpoint}/movie/popular?api_key=${tmdbKey}&language=es&page=1`)
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
     return axios.get(`${endpoint}/movie/top_rated?api_key=${tmdbKey}&language=es&page=1`)
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
 
    return axios.get(`${endpoint}/search/multi?api_key=${tmdbKey}&query=${queryName}&page=1&include_adult=false&language=es`)
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
 
    return axios.get(`${endpoint}/search/multi?api_key=${tmdbKey}&query=${queryName}&page=1&include_adult=false&language=es`)
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
    return axios.get(`${endpoint}/search/multi?api_key=${tmdbKey}&query=${queryName}&page=1&include_adult=false&language=es`)
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
  return axios.get(`${endpoint}/search/movie?api_key=${tmdbKey}&query=${queryName}&page=1&include_adult=false&language=es`)
      .then((result)=>{
      var element = result.data.results[0];
      var movieId = element.id;
      return axios.get(`${endpoint}/movie/${movieId}/credits?api_key=${tmdbKey}&language=es`)
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
  
    return axios.get(`${endpoint}/search/tv?api_key=${tmdbKey}&query=${queryName}&page=1&include_adult=false&language=es`)
      .then((result)=>{
      
      var element = result.data.results[0];
      var tvId = element.id;
      return axios.get(`${endpoint}/tv/${tvId}/credits?api_key=${tmdbKey}&language=es`)
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
    return axios.get(`${endpoint}/search/movie?api_key=${tmdbKey}&query=${queryName}&page=1&include_adult=false&language=es`)
      .then((result)=>{
      var element = result.data.results[0];
      var movieId = element.id;
      return axios.get(`${endpoint}/movie/${movieId}/credits?api_key=${tmdbKey}&language=es`)
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
    return axios.get(`${endpoint}/search/tv?api_key=${tmdbKey}&query=${queryName}&page=1&include_adult=false&language=es`)
      .then((result)=>{
      var element = result.data.results[0];
      var tvId = element.id;
      return axios.get(`${endpoint}/tv/${tvId}/credits?api_key=${tmdbKey}&language=es`)
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
    return axios.get(`${endpoint}/search/multi?api_key=${tmdbKey}&query=${queryName}&page=1&include_adult=false&language=es`)
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
    return axios.get(`${endpoint}/search/multi?api_key=${tmdbKey}&query=${queryName}&page=1&include_adult=false&language=es`)
      .then((result)=>{
      var element = result.data.results[0];
      var tvId = element.id;
     return axios.get(`${endpoint}/tv/${tvId}?api_key=${tmdbKey}&language=en-US`)
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
    return axios.get(`${endpoint}/search/multi?api_key=${tmdbKey}&query=${queryName}&page=1&include_adult=false&language=es`)
      .then((result)=>{   
      var element = result.data.results[0];
      var tvId = element.id;
       return axios.get(`${endpoint}/tv/${tvId}?api_key=${tmdbKey}&language=en-US`)
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
    return axios.get(`${endpoint}/search/movie?api_key=${tmdbKey}&query=${queryName}&page=1&include_adult=false&language=es`)
      .then((result)=>{
      var element = result.data.results[0];
      var movieId= element.id;
      return axios.get(`${endpoint}/movie/${movieId}?api_key=${tmdbKey}&language=es`)
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
    return axios.get(`${endpoint}/search/tv?api_key=${tmdbKey}&query=${queryName}&page=1&include_adult=false&language=es`)
      .then((result)=>{
      var element = result.data.results[0];
      var tvId= element.id;
      return axios.get(`${endpoint}/tv/${tvId}?api_key=${tmdbKey}&language=es`)
      .then((series)=>{
       agent.add(`Los generos de la serie ${series.data.name} son: `);
       series.data.genres.map((genre)=>{
         agent.add(`${genre.name}`);
       });
     });
     });
  }
  
  function handleSearchMediaOriginalTitle(){
    var medianame =agent.parameters.medianame;
    var arrayName = medianame.split(" ");
    var queryName = arrayName.join('-');
    return axios.get(`${endpoint}/search/multi?api_key=${tmdbKey}&query=${queryName}&page=1&include_adult=false&language=es`)
      .then((result)=>{
      var element = result.data.results[0];
      console.log("Element",element);
      var title = element.title==null?element.name:element.title;
      var mediaType = element.media_type;
      var originalTitle= element.original_name;
      agent.add(`Titulo orig: ${originalTitle}`);
      if(mediaType=="tv"){
        agent.add(`El título original de la serie ${title} es ${originalTitle}.`);
      } 
      if(mediaType=="movie"){
        agent.add(`El título original de la película ${title} es ${originalTitle}.`);
      }
    });
  }
  
  /*Tv videos */
  function handleSearchTvVideos(){
    var medianame =agent.parameters.medianame;
    var arrayName = medianame.split(" ");
    var queryName = arrayName.join('-');
    return axios.get(`${endpoint}/search/tv?api_key=${tmdbKey}&query=${queryName}&page=1&include_adult=false&language=es`)
      .then((result)=>{
      var element = result.data.results[0];
      var tvId = element.id;
      return axios.get(`${endpoint}/tv/${tvId}/videos?api_key=${tmdbKey}&language=en-us`)
      .then((series)=>{
         var video = series.data.results[0];
         var videoName = video.name;
         var site = video.site;
         var videoKey = video.key;
         var videoPath;
         if(site=="YouTube"){
           videoPath="https://www.youtube.com/watch?v="+videoKey;
         }
         if(site=="Vimeo"){
         	videoPath="https://vimeo.com/"+videoKey;
         }
         agent.add(new Card({
              title: videoName,
              imageUrl: videoPath,
            }));
       });    
    }); 
  }
  
  /*Tv videos */
  function handleSearchMovieVideos(){
    var medianame =agent.parameters.medianame;
    var arrayName = medianame.split(" ");
    var queryName = arrayName.join('-');
    return axios.get(`${endpoint}/search/movie?api_key=${tmdbKey}&query=${queryName}&page=1&include_adult=false&language=es`)
      .then((result)=>{
      var element = result.data.results[0];
      var movieId = element.id;
      return axios.get(`${endpoint}/movie/${movieId}/videos?api_key=${tmdbKey}&language=en-us`)
      .then((movie)=>{
         var video = movie.data.results[0];
         var videoName = video.name;
         var site = video.site;
         var videoKey = video.key;
         var videoPath;
         if(site=="YouTube"){
           videoPath="https://www.youtube.com/watch?v="+videoKey;
         }
         if(site=="Vimeo"){
         	videoPath="https://vimeo.com/"+videoKey;
         }
         agent.add(new Card({
              title: videoName,
              imageUrl: videoPath,
            }));
       });    
    }); 
  }
  
  function handleSearchTvOfficialPage(){
    var medianame =agent.parameters.medianame;
    var arrayName = medianame.split(" ");
    var queryName = arrayName.join('-');
    return axios.get(`${endpoint}/search/tv?api_key=${tmdbKey}&query=${queryName}&page=1&include_adult=false&language=es`)
      .then((result)=>{
      var element = result.data.results[0];
      var tvId = element.id;
      return axios.get(`${endpoint}/tv/${tvId}?api_key=${tmdbKey}&language=es`)
      .then((result)=>{
        var series = result.data;
        agent.add(`La página oficial de la serie ${series.name} es ${series.homepage}`);
      });
    });
  }
  
  function handleSearchMovieOfficialPage(){
    var medianame =agent.parameters.medianame;
    var arrayName = medianame.split(" ");
    var queryName = arrayName.join('-');
    return axios.get(`${endpoint}/search/movie?api_key=${tmdbKey}&query=${queryName}&page=1&include_adult=false&language=es`)
      .then((result)=>{
      var element = result.data.results[0];
      var movieId = element.id;
      return axios.get(`${endpoint}/movie/${movieId}?api_key=${tmdbKey}&language=es`)
      .then((result)=>{
        var movie = result.data;
        agent.add(`La página oficial de la película ${movie.title} es ${movie.homepage}`);
      });
    });
  }
  
  function handleSearchSimilarTvShows(){
    var medianame =agent.parameters.medianame;
    var arrayName = medianame.split(" ");
    var queryName = arrayName.join('-');
    return axios.get(`${endpoint}/search/tv?api_key=${tmdbKey}&query=${queryName}&page=1&include_adult=false&language=es`)
      .then((result)=>{
      var element = result.data.results[0];
      var tvId = element.id;
      return axios.get(`${endpoint}/tv/${tvId}/similar?api_key=${tmdbKey}&language=es&page=1`)
      .then((series)=>{
        var count = 0;
        series.data.results.map((element)=>{
          if(count<4){
          count++;
          var name = element.name;
          var posterPath = imgPth+element.poster_path;
           agent.add(new Card({
              title: name,
              imageUrl: posterPath
            }));
          }
        });
      });
    });
  }
  
  function handleSearchSimilarMovies(){
    var medianame =agent.parameters.medianame;
    var arrayName = medianame.split(" ");
    var queryName = arrayName.join('-');
    return axios.get(`${endpoint}/search/movie?api_key=${tmdbKey}&query=${queryName}&page=1&include_adult=false&language=es`)
      .then((result)=>{
      var element = result.data.results[0];
      var movieId = element.id;
      return axios.get(`${endpoint}/movie/${movieId}/similar?api_key=${tmdbKey}&language=es&page=1`)
      .then((movie)=>{
        var count = 0;
        movie.data.results.map((element)=>{
          if(count<4){
          count++;
          var name = element.title;
          var posterPath = imgPth+element.poster_path;
           agent.add(new Card({
              title: name,
              imageUrl: posterPath
            }));
          }
        });
      });
    });
  }
  
  function handleSearchMediaIsAdult(){
    var medianame =agent.parameters.medianame;
    var arrayName = medianame.split(" ");
    var queryName = arrayName.join('-');
    return axios.get(`${endpoint}/search/multi?api_key=${tmdbKey}&query=${queryName}&page=1&include_adult=false&language=es`)
      .then((result)=>{
      var element = result.data.results[0];
      var title = element.title==null?element.name:element.title;
      var mediaType =  element.media_type;
      var adult = element.adult;
      if(mediaType=="tv"){
        if(adult){
          agent.add(`La serie ${title} es para mayores de edad.`);
        }else{
          agent.add(`La serie ${title} es para todos los públicos.`);
        }
      }
      if(mediaType=="movie"){
        if(adult){
          agent.add(`La película ${title} es para mayores de edad.`);
        }else{
          agent.add(`La película ${title} es para todos los públicos. `);
        }
      }
    });  
  }
  
  function handleSearchActorPopularMovies(){
    var medianame =agent.parameters.medianame;
    var arrayName = medianame.split(" ");
    var queryName = arrayName.join('-');
    return axios.get(`${endpoint}/search/person?api_key=${tmdbKey}&query=${queryName}&language=es&page=1&include_adult=true`)
      .then((result)=>{
      var element = result.data.results[0];
      var personId = element.id;
      return axios.get(`${endpoint}/person/${personId}/movie_credits?api_key=${tmdbKey}&language=es&sort_by=popularity.desc`)
      .then((credits)=>{
        var count = 0;
        credits.data.cast.map((element)=>{
          if(count<7){
          count++;
          var name = element.title;
          var posterPath = imgPth+element.poster_path;
          var character = "Personaje: "+element.character;
           agent.add(new Card({
              title: name,
              imageUrl: posterPath,
              text: character
            }));
          }
        });
      });
    });
  }
  
  function handleSearchActorPopularTvShows(){
    var medianame =agent.parameters.medianame;
    var arrayName = medianame.split(" ");
    var queryName = arrayName.join('-');
    return axios.get(`${endpoint}/search/person?api_key=${tmdbKey}&query=${queryName}&language=es&page=1&include_adult=true`)
      .then((result)=>{
      var element = result.data.results[0];
      var personId = element.id;
      return axios.get(`${endpoint}/person/${personId}/tv_credits?api_key=${tmdbKey}&language=es&sort_by=popularity.desc`)
      .then((credits)=>{
        var count = 0;
        credits.data.cast.map((element)=>{
          if(count<7){
          count++;
          var name = element.name;
          var posterPath = imgPth+element.poster_path;
          var character = element.character;
          var numberOfEpisodes = element.episode_count;
          var cardText = "Personaje: "+character+"\n"+
              "Aparece en "+numberOfEpisodes+" episodios";
           agent.add(new Card({
              title: name,
              imageUrl: posterPath,
              text: cardText
            }));
          }
        });
      });
    });
  }
  
  function handleSearchMovieReviews(){
    var medianame =agent.parameters.medianame;
    var arrayName = medianame.split(" ");
    var queryName = arrayName.join('-');
    return axios.get(`${endpoint}/search/movie?api_key=${tmdbKey}&query=${queryName}&page=1&include_adult=false&language=es`)
      .then((result)=>{
      var element = result.data.results[0];
      var movieId = element.id;
      var title = element.title;
      agent.add(`Reseñas para la película ${title}`);
      return axios.get(`${endpoint}/movie/${movieId}/reviews?api_key=${tmdbKey}&language=es&page=1`)
      .then((movie)=>{
        movie.data.results.map((review)=>{
          var reviewAuthor = review.author;
          var content = review.content;   
          agent.add(new Card({
              title: "Autor: "+reviewAuthor,
              text: content
            }));
        });
      });
    });
  }
  
  function handleSearchTvReviews(){
    var medianame =agent.parameters.medianame;
    var arrayName = medianame.split(" ");
    var queryName = arrayName.join('-');
    return axios.get(`${endpoint}/search/tv?api_key=${tmdbKey}&query=${queryName}&page=1&include_adult=false&language=es`)
      .then((result)=>{
      var element = result.data.results[0];
      var tvId = element.id;
      var name = element.name;
      agent.add(`Tv Id: ${tvId}`);
      agent.add(`Reseñas para la serie ${name}`);
      return axios.get(`${endpoint}/tv/${tvId}/reviews?api_key=${tmdbKey}&language=es&page=1`)
      .then((series)=>{
        series.data.results.map((review)=>{
          var reviewAuthor = review.author;
          var content = review.content;   
          agent.add(new Card({
              title: "Autor: "+reviewAuthor,
              text: content
            }));
        });
      });
    });
  }
  
  function handleSearchActorBiography(){
    var medianame =agent.parameters.medianame;
    var arrayName = medianame.split(" ");
    var queryName = arrayName.join('-');
    return axios.get(`${endpoint}/search/person?api_key=${tmdbKey}&query=${queryName}&language=es&page=1&include_adult=false`)
      .then((result)=>{
      var element = result.data.results[0];
      var personId = element.id;
      return axios.get(`${endpoint}/person/${personId}?api_key=${tmdbKey}&language=es`)
      .then((person)=>{
        var name = person.data.name;
        var biography = person.data.biography;
        var gender = person.data.gender;
        var cardTitle = "";
        var posterPath=imgPth+person.data.profile_path;
        if(gender=="1"){
          cardTitle="Biografía de la actriz "+name+":\n";
        }
        if(gender=="2"){
          cardTitle="Biografía del actor "+name+":\n";
        }
        agent.add(new Card({
              title: cardTitle,
          	  imageUrl:posterPath,
              text: biography
            }));
      });
    });
  }
  
  function handleSearchActorBirthdate(){
    var medianame =agent.parameters.medianame;
    var arrayName = medianame.split(" ");
    var queryName = arrayName.join('-');
    return axios.get(`${endpoint}/search/person?api_key=${tmdbKey}&query=${queryName}&language=es&page=1&include_adult=false`)
      .then((result)=>{
      var element = result.data.results[0];
      var personId = element.id;
      return axios.get(`${endpoint}/person/${personId}?api_key=${tmdbKey}&language=es`)
      .then((person)=>{
        var name = person.data.name;
        var birthdate = person.data.birthday;
        var placeOfBirth = person.data.place_of_birth;
        var gender = person.data.gender;
        var posterPath=imgPth+person.data.profile_path;
        var cardText = "";
        if(gender=="1"){
          cardText="La actriz "+name+" nació el "+birthdate+" en "+placeOfBirth;
        }
        if(gender=="2"){
          cardText="El actor "+name+" nació el "+birthdate+" en "+placeOfBirth;
        }
        agent.add(new Card({
              title: "Fecha de nacimiento de "+name,
          	  imageUrl:posterPath,
              text: cardText
            }));
      });
    });
  }
  
  function handleSearchActorRoleInMovie(){
    var medianame =agent.parameters.medianame;
    var person = agent.parameters.person;
    var arrayName = person.split(" ");
    var arrayMovie = medianame.split(" ");
    var queryName = arrayName.join('-');
    var queryMovie = arrayMovie.join('-');
    return axios.get(`${endpoint}/search/person?api_key=${tmdbKey}&query=${queryName}&language=es&page=1`)
      .then((result)=>{
      var element = result.data.results[0];
      var personId = element.id;
      var personName = element.name;
      return axios.get(`${endpoint}/search/movie?api_key=${tmdbKey}&query=${queryMovie}&language=es&page=1`)
      .then((movies)=>{
        var movie = movies.data.results[0];
        var title = movie.title;
        var originalTitle = movie.original_title;
      return axios.get(`${endpoint}/person/${personId}/movie_credits?api_key=${tmdbKey}&language=es&sort_by=popularity.desc`)
      .then((credits)=>{
        credits.data.cast.map((credit)=>{
          var creditTitle=credit.title;
          var creditOriginalTitle =credit.original_title;
          if(title==creditTitle||originalTitle==creditOriginalTitle){
            var posterPath = imgPth+credit.backdrop_path;
            var character = credit.character;
            var cardText = "El papel que interpreta "+personName+" en "+title+" es "+character+".";
            agent.add(new Card({
              title: title,
          	  imageUrl:posterPath,
              text: cardText
            }));
          }
        });
      });
    });
    });
  }

  function handleSearchActorRoleInTvShow(){
    var person = agent.parameters.person;
    var medianame = agent.parameters.medianame;
    var arrayPerson = person.split(" ");
    var arrayMedia = medianame.split(" ");
    var queryPerson = arrayPerson.join('-');
    var queryMedia = arrayMedia.join('-');
     return axios.get(`${endpoint}/search/person?api_key=${tmdbKey}&query=${queryPerson}&language=es&page=1`)
      .then((result)=>{
       var element = result.data.results[0];
       var personId = element.id;
       var personName = element.name;
       return axios.get(`${endpoint}/search/tv?api_key=${tmdbKey}&query=${queryMedia}&language=es&page=1`)
      .then((series)=>{
         var show = series.data.results[0];
         var title = show.name;
         var originalTitle = show.original_name;
         return axios.get(`${endpoint}/person/${personId}/tv_credits?api_key=${tmdbKey}&language=es&sort_by=popularity.desc`)
         .then((credits)=>{
          credits.data.cast.map((credit)=>{
          var creditTitle=credit.name;
          var creditOriginalTitle =credit.original_name;
          if(title==creditTitle||originalTitle==creditOriginalTitle){
            var posterPath = imgPth+credit.backdrop_path;
            var character = credit.character;
            var cardText = "El papel que interpreta "+personName+" en "+title+" es "+character+".";
            agent.add(new Card({
              title: title,
          	  imageUrl:posterPath,
              text: cardText
            }));
          }
        });
       });
      });
    });
  }

  /*Movie Info: Duration*/
  function handleSearchMovieDuration(){
    const medianame = agent.parameters.medianame;
    var arrayName = medianame.split(" ");
    var queryName = arrayName.join('-');
    return axios.get(`${endpoint}/search/movie?api_key=${tmdbKey}&query=${queryName}&page=1&include_adult=false&language=es`)
      .then((result)=>{
      var element = result.data.results[0];
      var movieId = element.id;
      var movieName = element.title;
       return axios.get(`${endpoint}/movie/${movieId}?api_key=${tmdbKey}`)
      .then((movie)=>{
       var runtime = movie.data.runtime;
       agent.add(`La duración de la película ${movieName} es ${runtime} minutos.`);
       });
    });
  }
  
  /*Actor Info: Images*/
  function handleSearchActorImages(){
    const medianame = agent.parameters.medianame;
    var arrayName = medianame.split(" ");
    var queryName = arrayName.join('-');
    return axios.get(`${endpoint}/search/person?api_key=${tmdbKey}&query=${queryName}&page=1&include_adult=false&language=es`)
      .then((result)=>{
      var element = result.data.results[0];
      var personId = element.id;
      var personName = element.name;
      return axios.get(`${endpoint}/person/${personId}/images?api_key=${tmdbKey}`)
      .then((photos)=>{
        agent.add(`Estas son algunas imágenes de ${personName}: `);
      	photos.data.profiles.map((photo)=>{
          var image=imgPth+photo.file_path;
          agent.add(new Image(image));
        });
      });
    });
  }
  
  /*Movie Info: images*/
  function handleSearchMovieImages(){
    const medianame = agent.parameters.medianame;
    var arrayName = medianame.split(" ");
    var queryName = arrayName.join('-');
    return axios.get(`${endpoint}/search/movie?api_key=${tmdbKey}&query=${queryName}&page=1&include_adult=false&language=es`)
      .then((result)=>{
      var element = result.data.results[0];
      var movieId = element.id;
      var movieName = element.title;
      return axios.get(`${endpoint}/movie/${movieId}/images?api_key=${tmdbKey}&language=es`)
      .then((photos)=>{
        agent.add(`Estas son algunas imágenes de ${movieName}: `);
      	photos.data.posters.map((photo)=>{
          var image=imgPth+photo.file_path;
          agent.add(new Image(image));
        });
      });
    });
  }
 
  /*Tv Show Info: Images*/
  function handleSearchTvShowImages(){
    const medianame = agent.parameters.medianame;
    var arrayName = medianame.split(" ");
    var queryName = arrayName.join('-');
    return axios.get(`${endpoint}/search/tv?api_key=${tmdbKey}&query=${queryName}&page=1&include_adult=false&language=es`)
      .then((result)=>{
      var element = result.data.results[0];
      var showId = element.id;
      var showName = element.name;
      return axios.get(`${endpoint}/tv/${showId}/images?api_key=${tmdbKey}&language=es`)
      .then((photos)=>{
        agent.add(`Estas son algunas imágenes de ${showName}: `);
      	photos.data.posters.map((photo)=>{
          var image=imgPth+photo.file_path;
          agent.add(new Image(image));
        });
      });
    });
  }
  
  /*Movie Info: Budget*/
  function handleSearchMovieBudget(){
    var medianame =agent.parameters.medianame;
    var arrayName = medianame.split(" ");
    var queryName = arrayName.join('-');
    return axios.get(`${endpoint}/search/movie?api_key=${tmdbKey}&query=${queryName}&page=1&include_adult=false&language=es`)
      .then((result)=>{
     var element = result.data.results[0];
     var movieId= element.id;
     var movieName = element.title;
     return axios.get(`${endpoint}/movie/${movieId}?api_key=${tmdbKey}&language=es`)
      .then((movie)=>{
       var media = movie.data;
       var budget = media.budget;
       agent.add(`El presupuesto de la película ${movieName} es de ${budget} `);
     });
    });
  }
  
  /*Movie Info: Revenue*/
  function handleSearchMovieRevenue(){
    var medianame =agent.parameters.medianame;
    var arrayName = medianame.split(" ");
    var queryName = arrayName.join('-');
    return axios.get(`${endpoint}/search/movie?api_key=${tmdbKey}&query=${queryName}&page=1&include_adult=false&language=es`)
      .then((result)=>{
     var element = result.data.results[0];
     var movieId= element.id;
     var movieName = element.title;
     return axios.get(`${endpoint}/movie/${movieId}?api_key=${tmdbKey}&language=es`)
      .then((movie)=>{
       var media = movie.data;
       var revenue = media.revenue;
       agent.add(`Los ingresos de la película ${movieName} son de ${revenue} `);
     });
    });
  }

  /*Search: Most Popular Shows*/
  function handleSearchMostPopularTvShows(){
     return axios.get(`${endpoint}/tv/popular?api_key=${tmdbKey}&language=es&page=1`)
        .then((result)=>{
       		result.data.results.map((tv)=>{
              var name= tv.name;
              var cardText=
              "**Puntuación media:** "+tv.vote_average+"\n"+
              "**Fecha de estreno:** "+tv.release_date+"\n"+
              "**Idioma original:** "+tv.original_language+"\n"+
              "**Resumen:** "+tv.overview+"\n";
              var posterPath = imgPth+tv.poster_path;
              agent.add(new Card({
               title: name,
               imageUrl: posterPath,
               text: cardText
             }));
           });
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
              var cardText = 
                  "Puntuación media: "+show.vote_average+"\n"+
                  "Resumen"+show.overview+"";
              agent.add(new Card({
                title: showName,
                imageUrl: posterPath,
                text: cardText
              }));
            });
      });
    });
  }
  
  function handleSearchTopRatedTvShows(){
    return axios.get(`${endpoint}/tv/top_rated?api_key=${tmdbKey}&language=es&page=1`)
        .then((result)=>{
       		result.data.results.map((show)=>{
              var name= show.name;
              var cardText=
              "**Puntuación media:** "+show.vote_average+"\n"+
              "**Fecha de estreno:** "+show.release_date+"\n"+
              "**Idioma original:** "+show.original_language+"\n"+
              "**Resumen:** "+show.overview+"\n";
              var posterPath = imgPth+show.poster_path;
              agent.add(new Card({
               title: name,
               imageUrl: posterPath,
               text: cardText
              }));
           });
    });
  }
  
  function handleSearchTvShowSeasonInfo(){
    var medianame =agent.parameters.medianame;
    var arrayName = medianame.split(" ");
    var queryName = arrayName.join('-');
    var seasonNumber = agent.parameters.seasonNumber;
    return axios.get(`${endpoint}/search/tv?api_key=${tmdbKey}&language=es&page=1&query=${queryName}&include_adult=false`)
        .then((result)=>{
      var element = result.data.results[0];
      var showId = element.id;
      var showName = element.name;
      return axios.get(`${endpoint}/tv/${showId}/season/${seasonNumber}?api_key=${tmdbKey}&language=es`)
        .then((season)=>{
        var numberEpisodes = 0;
        season.data.episodes.map((episode)=>{numberEpisodes++;});
        var cardText="Fecha de primera emisión: "+season.data.air_date+" \n "+
            "Número de episodios: "+numberEpisodes+" \n "+
            "Resumen de la temporada: "+season.data.overview;
        var posterPath=imgPth+season.data.poster_path;
        agent.add(new Card({
               title: showName+" (Temporada "+seasonNumber+")",
               imageUrl: posterPath,
               text: cardText
              }));
      });
    });
  }
  
  function handleSearchTvShowEpisodeInfo(){
     var medianame =agent.parameters.medianame;
    var arrayName = medianame.split(" ");
    var queryName = arrayName.join('-');
    var seasonNumber = agent.parameters.seasonNumber;
    var episodeNumber = agent.parameters.episodeNumber;
    return axios.get(`${endpoint}/search/tv?api_key=${tmdbKey}&language=es&page=1&query=${queryName}&include_adult=false`)
        .then((result)=>{
      var element = result.data.results[0];
      var showId = element.id;
      var showName = element.name;
      return axios.get(`${endpoint}/tv/${showId}/season/${seasonNumber}/episode/${episodeNumber}?api_key=${tmdbKey}&language=es`)
        .then((episode)=>{
        var title = episode.data.name;
        var cardText ="Fecha de emisión: "+episode.data.air_date+" \n "+
            "Número de episodio: "+episode.data.episode_number+" \n "+
            "Número de temporada: "+episode.data.season_number+" \n "+
            "Puntuación: "+episode.data.vote_average+" \n "+
            "Resumen: "+episode.data.overview;
        var posterPath=imgPth+episode.data.still_path;
        agent.add(`${title}`);
        agent.add(`${cardText}`);
        agent.add(new Image(posterPath));
        /*agent.add(new Card({
               title: title,
               imageUrl: posterPath,
               text: cardText
              }));*/
      });
    });
  }
   
  /******* MAPING INTENTS *******/
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
  intentMap.set('SearchMediaOriginalTitle', handleSearchMediaOriginalTitle);
  intentMap.set('SearchTvVideos', handleSearchTvVideos);
  intentMap.set('SearchMovieVideos', handleSearchMovieVideos);
  intentMap.set('SearchTvOfficialPage', handleSearchTvOfficialPage);
  intentMap.set('SearchMovieOfficialPage', handleSearchMovieOfficialPage);
  intentMap.set('SearchSimilarTvShows', handleSearchSimilarTvShows);
  intentMap.set('SearchSimilarMovies', handleSearchSimilarMovies);
  intentMap.set('SearchMediaIsAdult', handleSearchMediaIsAdult);
  intentMap.set('SearchActorPopularMovies', handleSearchActorPopularMovies);
  intentMap.set('SearchActorPopularTvShows', handleSearchActorPopularTvShows);
  intentMap.set('SearchMovieReviews', handleSearchMovieReviews);
  intentMap.set('SearchTvReviews', handleSearchTvReviews);
  intentMap.set('SearchActorBiography', handleSearchActorBiography);
  intentMap.set('SearchActorBirthdate', handleSearchActorBirthdate);
  intentMap.set('SearchActorRoleInMovie', handleSearchActorRoleInMovie);
  intentMap.set('SearchActorRoleInTvShow', handleSearchActorRoleInTvShow);
  intentMap.set('SearchMovieDuration', handleSearchMovieDuration);
  intentMap.set('SearchActorImages', handleSearchActorImages);
  intentMap.set('SearchMovieImages', handleSearchMovieImages);
  intentMap.set('SearchTvShowImages', handleSearchTvShowImages);
  intentMap.set('SearchMovieBudget', handleSearchMovieBudget);
  intentMap.set('SearchMovieRevenue', handleSearchMovieRevenue);
  intentMap.set('SearchMostPopularTvShows', handleSearchMostPopularTvShows);
  intentMap.set('SearchGenreMostPopularMovies', handleSearchGenreMostPopularMovies);
  intentMap.set('SearchYearMostPopularMovies', handleSearchYearMostPopularMovies);
  intentMap.set('SearchGenreMostPopularShows', handleSearchGenreMostPopularShows);
  intentMap.set('SearchTopRatedTvShows', handleSearchTopRatedTvShows);
  intentMap.set('SearchTvShowSeasonInfo', handleSearchTvShowSeasonInfo);
  intentMap.set('SearchTvShowEpisodeInfo', handleSearchTvShowEpisodeInfo);
  agent.handleRequest(intentMap);
});
