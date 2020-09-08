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
        agent.add(new Card({
              title: "Contraseña",
              text: "Adelante, introduce una contraseña",
            }));
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
        agent.add(`Lo siento, la contraseña o el usuario no son correctos. ¿Quieres volver a intentarlo?`);
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
    const username = agent.parameters.username;
    const password = agent.parameters.password;
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
    agent.setFollowupEvent({ "name": "correctaccess", "parameters" : { "username": username, "password":password, "alias":alias, "email":email}});
  }
  
  /*******SEARCHING CONTENTS*******/
  /*General Info Search: Movies, Shows and People. Displaying basic info*/
  function handleMediaSearch(){
    const medianame = agent.parameters.medianame;
    var arrayName = medianame.split(" ");
    var queryName = arrayName.join('-');
    agent.add(new Card({title: "Resultados",text: `Para ${medianame}`}));
    return axios.get(`${endpoint}/search/multi?api_key=${tmdbKey}&query=${queryName}&page=1&include_adult=false&language=es`)
      .then((result)=>{
      console.log("RESULTTT:",result.data.results);
      if(result.data.results.length>0){
        var count = 0;
        result.data.results.map((media) =>{
          if(count < 5){
            count++;
            var mediaType=media.media_type;
            var title, fullTitle, cardText, posterPath = "";
            var voteAverage, releaseDate, overview;
            /*Person generic view*/
            if(mediaType=="person"){
              title =`${media.name}`;
              var department = media.known_for_department;
              var gender = media.gender;
              var occupation = "";
              if(department=="Acting"){
                if(gender==1){
                  occupation = "Actriz";
                }
                if(gender==2){
                  occupation= "Actor";
                }
              }
              fullTitle = `${count}. ${title} (${occupation})`;
              cardText = "";
              posterPath = imgPth+media.profile_path;
              var countNotable = 0;
              media.known_for.map((notable) => {
                  var notableName = notable.title==null?notable.name:notable.title;
                  cardText = cardText+notableName+"\n";
              });
              cardText = cardText!=""?"**Conocido por** :\n"+cardText:cardText;
            }
            /*Tv Show generic view*/
            if(mediaType=="tv"){
              fullTitle =`${count}. ${media.name} (Serie de televisión)`;
              voteAverage = media.vote_average==0?"":"Nota media: "+media.vote_average;
              releaseDate = media.first_air_date==null?"":"Fecha de estreno: "+media.first_air_date;
              overview = media.overview == ""?"":"Resumen: "+media.overview;
              cardText = voteAverage+"\n"+releaseDate+"\n"+overview;
              posterPath = imgPth+media.poster_path;
            }
            /*Movie generic view*/
            if(mediaType=="movie"){
              fullTitle = `${count}. ${media.title} (Película)`;
              voteAverage = media.vote_average==0?"":"Nota media: "+media.vote_average;
              releaseDate = media.release_date==null?"":"Fecha de estreno: "+media.release_date;
              overview = media.overview == ""?"":"Resumen: "+media.overview;
              cardText = voteAverage+"\n"+releaseDate+"\n"+overview;
              posterPath = imgPth+media.poster_path;
            }
            agent.add(new Card({
              title: fullTitle,
              imageUrl: posterPath,
              text: cardText,
              buttonText: `Ver detalles`,
              buttonUrl: `${media.name} (${mediaType} : ${media.id})`,
            }));
          }
        });
      }else{
        agent.add(`No se han encontrado resultados para la búsqueda de ${medianame}. Vuelve a intentarlo`);
      }
    });
  }
  
  /*Display details: Visualize the details of a movie, show or person*/
  function handleViewMediaDetails(){
    var mediaelement = agent.parameters.mediaelement;
    var mediatype = agent.parameters.mediatype;
    var mediaid = agent.parameters.mediaid;
    /*Person details*/
    if(mediatype=="person"){
       return axios.get(`${endpoint}/person/${mediaid}?api_key=${tmdbKey}&language=es`)
      .then((result)=>{
         var person = result.data;
         var name = person.name;
         var department = person.known_for_department;
         var knownDepartment = "Ocupación: ";
         if(department=="Acting"){knownDepartment = knownDepartment+"Actuación \n";}
         if(department=="Directing"){knownDepartment = knownDepartment+"Dirección \n";}
         if(department=="Production"){knownDepartment = knownDepartment+"Producción \n"; }
         var birthday ="Fecha de nacimiento: "+person.birthday+"\n";
         var deathday = person.deathday==null?"":"Fecha de fallecimiento: "+person.deathday+"\n";
         var placeOfBirth = "Lugar de nacimiento: "+person.place_of_birth+"\n";
         var biography = person.biography==""?"":"Biografía: "+person.biography+"\n";
         var personalWeb = person.homepage==""?"":"Página web: "+person.homepage+"\n";
         var cardText=knownDepartment+birthday+deathday+placeOfBirth+biography+personalWeb;
         var image= imgPth+result.data.profile_path;
         agent.add(new Card({title: "Detalles" ,text: `Mostrando detalles para ${name}`}));
         agent.add(new Card({title: name,imageUrl: image,text: cardText}));
       });
    }
    /*Show Details*/
    if(mediatype=="tv"){
       return axios.get(`${endpoint}/tv/${mediaid}?api_key=${tmdbKey}&language=es`)
      .then((result)=>{
         var show = result.data;
         var name = show.name;
         var voteAverage = show.vote_average==0?"":"Puntuación media: "+show.vote_average+"\n";
         var nextEpisode = show.next_episode_to_air==null?"":"Próximo episodio: "+show.next_episode_to_air+"\n";
         var totalEpisodes = show.number_of_episodes==0?"":"Total de episodios: "+show.number_of_episodes+"\n";
         var totalSeasons = show.number_of_seasons==0?"":"Total de temporadas: "+show.number_of_seasons+"\n";
         var airDate = show.first_air_date==null?"":"Fecha de estreno: "+show.first_air_date+"\n";
         var status ;
         if(show.status=="Ended"){status="Estado: Finalizada \n";}
         if(show.status=="Returning Series"){status="Estado: Renovada \n";}
         if(show.status=="Canceled"){status="Estado: Cancelada \n";}
         var lastAirDate = show.last_air_date==null?"":"Última fecha de emisión: "+show.last_air_date+"\n";
         var originalLanguage = "Idioma original: "+show.original_language+"\n";
         var overview = show.overview==""?"":"Resumen: "+show.overview+"\n";
         var inProduction = show.in_production;
         var genres =show.genres.length>0?"Géneros: \n":"";
         show.genres.map((genre) => {genres = genres+genre.name+"\n";});
         var direction = show.created_by.length>0?"Dirección: \n":"";
         show.created_by.map((director)=>{direction=direction+director.name+"\n";});
         var posterPath = imgPth+show.poster_path;
         var cardText = voteAverage+nextEpisode+totalEpisodes+
             totalSeasons+airDate+status+lastAirDate+originalLanguage+overview+direction+genres;
       	 agent.add(new Card({title: name,imageUrl: posterPath,text: cardText}));	 
       });
    }
    /*Movie Details*/
    if(mediatype=="movie"){
      return axios.get(`${endpoint}/movie/${mediaid}?api_key=${tmdbKey}&language=es`)
      .then((result)=>{
        var movie = result.data;
        var name= movie.title;
        var tagline= tagline==""?"":"__"+movie.tagline+"__ \n";
        var voteAverage = movie.vote_average==0?"":"Puntuación media: "+movie.vote_average+"\n";
        var releaseDate = movie.release_date==null?"":"Fecha de estreno: "+movie.release_date+"\n";
        var originalLanguage = "Idioma original: "+movie.original_language+"\n";
        var status;
        if(movie.status=="Released"){status="Estado: Estrenada \n";}
        if(movie.status=="Post Production"){status="Estado: Post-Producción \n";}
        if(movie.status=="In Production"){status="Estado: En Producción \n";}
        if(movie.status=="Planned"){status="Estado: Planeada \n";}
        var runtime = movie.runtime==0?"":"Duración: "+movie.runtime+"minutos \n";
        var budget= movie.budget==0?"":"Presupuesto: "+movie.budget+"\n";
        var revenue = movie.revenue==0?"":"Recaudado: "+movie.revenue+"\n";
        var homepage = movie.homepage==""?"":"Página oficial: "+movie.homepage+"\n";
        var overview = movie.overview==""?"":"Resumen: "+movie.overview+"\n";
        var genres = movie.genres.length>0?"Géneros: \n":"";
        result.data.genres.map((genre) => {genres = genres+genre.name+"\n";});
        var cardText = tagline+voteAverage+releaseDate+originalLanguage+
            status+budget+runtime+revenue+genres+overview;
        var posterPath = imgPth+result.data.poster_path;
        agent.add(new Card({title: name,imageUrl: posterPath,text: cardText}));
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
                  "Resumen: "+show.overview+"";
              agent.add(new Card({
                title: showName,
                imageUrl: posterPath,
                text: cardText
              }));
            });
      });
    });
  }
  
  /*Searching Top Rated Shows*/
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
  
  /*Tv Show Info: Season Details*/
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
  
  /*Tv Show Info: Episode Details*/
  function handleSearchTvShowEpisodeInfo(){
     var medianame =agent.parameters.medianame;
    var arrayName = medianame.split(" ");
    var queryName = arrayName.join('-');
    var seasonNumber = agent.parameters.seasonNumber;
    var episodeNumber = agent.parameters.episodeNumber;
    agent.add(`Episodio: ${episodeNumber}, temporada: ${seasonNumber}, query: ${queryName}`);
    return axios.get(`${endpoint}/search/tv?api_key=${tmdbKey}&language=es&page=1&query=${queryName}&include_adult=false`)
        .then((result)=>{
      var element = result.data.results[0];
      var showId = element.id;
      agent.add(`Show ID: ${showId}`);
     return axios.get(`${endpoint}/tv/${showId}/season/${seasonNumber}/episode/${episodeNumber}?api_key=${tmdbKey}&language=es`)
        .then((episode)=>{
        var title = episode.data.name;
        var cardText ="Fecha de emisión: "+episode.data.air_date+" \n "+
            "Número de episodio: "+episode.data.episode_number+" \n "+
            "Número de temporada: "+episode.data.season_number+" \n "+
            "Puntuación: "+episode.data.vote_average+" \n "+
            "Resumen: "+episode.data.overview;
        var posterPath=imgPth+episode.data.still_path;
        agent.add(new Card({
               title: title,
               imageUrl: posterPath,
               text: cardText
              }));
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
    var arrayName = medianame.split(" ");
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
    var arrayName = medianame.split(" ");
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
  intentMap.set('SearchGenreYearMostPopularMovies', handleSearchGenreYearMostPopularMovies);
  intentMap.set('SearchYearActorMostPopularMovies', handleSearchYearActorMostPopularMovies);
  intentMap.set('SearchGenreActorMostPopularMovies', handleSearchGenreActorMostPopularMovies);
  agent.handleRequest(intentMap);
});
