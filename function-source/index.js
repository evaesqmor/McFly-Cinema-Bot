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
            agent.add(new Card({title: fullTitle,imageUrl: posterPath,
              text: cardText,buttonText: `Ver detalles`,
              buttonUrl: `${media.name} (${mediaType} : ${media.id})`}));
          }
        });
      }else{agent.add(`No se han encontrado resultados para la búsqueda de ${medianame}. Vuelve a intentarlo`);}
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
         var personalWeb = person.homepage==null?"":"Página web: "+person.homepage+"\n";
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
       	 agent.add(new Card({title: "Detalles" ,text: `Mostrando detalles para ${name}`}));
         agent.add(new Card({title: name,imageUrl: posterPath,text: cardText}));	 
       });
    }
    /*Movie Details*/
    if(mediatype=="movie"){
      return axios.get(`${endpoint}/movie/${mediaid}?api_key=${tmdbKey}&language=es`)
      .then((result)=>{
        var movie = result.data;
        var name= movie.title;
        var tagline= movie.tagline;
        var voteAverage = movie.vote_average==0?"":"Puntuación media: "+movie.vote_average+"\n";
        var releaseDate = movie.release_date==null?"":"Fecha de estreno: "+movie.release_date+"\n";
        var originalLanguage = "Idioma original: "+movie.original_language+"\n";
        var status;
        if(movie.status=="Released"){status="Estado: Estrenada \n";}
        if(movie.status=="Post Production"){status="Estado: Post-Producción \n";}
        if(movie.status=="In Production"){status="Estado: En Producción \n";}
        if(movie.status=="Planned"){status="Estado: Planeada \n";}
        var runtime = movie.runtime==0?"":"Duración: "+movie.runtime+" minutos \n";
        var budget= movie.budget==0?"":"Presupuesto: "+movie.budget+"\n";
        var revenue = movie.revenue==0?"":"Recaudado: "+movie.revenue+"\n";
        var homepage = movie.homepage==""?"":"Página oficial: "+movie.homepage+"\n";
        var overview = movie.overview==""?"":"Resumen: "+movie.overview+"\n";
        var genres = movie.genres.length>0?"Géneros: \n":"";
        result.data.genres.map((genre) => {genres = genres+genre.name+"\n";});
        var cardText = tagline+voteAverage+releaseDate+originalLanguage+
            status+budget+runtime+revenue+genres+overview;
        var posterPath = imgPth+result.data.poster_path;
        agent.add(new Card({title: "Detalles" ,text: `Mostrando detalles para ${name}`}));
        agent.add(new Card({title: name,imageUrl: posterPath,text: cardText}));
      });
    }
  }
  
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
          var originalLanguage= movie.original_language==""?"":"Idioma original: "+movie.original_language+"\n"; 
          var overview = movie.overview==""?"":"Resumen: "+movie.overview;
          var cardText=voteAverage+releaseDate+originalLanguage+overview;
          var posterPath = imgPth+movie.poster_path;
          agent.add(new Card({title: name,imageUrl: posterPath,text: cardText, buttonText: `Ver detalles`,
              buttonUrl: `${name} (movie:${mediaid})`}));
          }
        });
        }else{
          agent.add(new Card({title: "Sin resultados" , text: `No se han encontrado películas actualmente en cines. Inténtalo en otro momento`}));
        }
      }); 
  }
  
  /*Display details: Visualize the details of a movies now on cinemas*/
  function handleViewNowShowingDetails(){
    var mediaelement = agent.parameters.mediaelement;
    var mediaid = agent.parameters.mediaid;
    /*Movie Details*/
    return axios.get(`${endpoint}/movie/${mediaid}?api_key=${tmdbKey}&language=es`)
      .then((result)=>{
        var movie = result.data;
        var name= movie.title;
        var tagline= movie.tagline;
        var voteAverage = movie.vote_average==0?"":"Puntuación media: "+movie.vote_average+"\n";
        var releaseDate = movie.release_date==null?"":"Fecha de estreno: "+movie.release_date+"\n";
        var originalLanguage = "Idioma original: "+movie.original_language+"\n";
        var status;
        if(movie.status=="Released"){status="Estado: Estrenada \n";}
        if(movie.status=="Post Production"){status="Estado: Post-Producción \n";}
        if(movie.status=="In Production"){status="Estado: En Producción \n";}
        if(movie.status=="Planned"){status="Estado: Planeada \n";}
        var runtime = movie.runtime==0?"":"Duración: "+movie.runtime+" minutos \n";
        var budget= movie.budget==0?"":"Presupuesto: "+movie.budget+"\n";
        var revenue = movie.revenue==0?"":"Recaudado: "+movie.revenue+"\n";
        var homepage = movie.homepage==""?"":"Página oficial: "+movie.homepage+"\n";
        var overview = movie.overview==""?"":"Resumen: "+movie.overview+"\n";
        var genres = movie.genres.length>0?"Géneros: \n":"";
        result.data.genres.map((genre) => {genres = genres+genre.name+"\n";});
        var cardText = tagline+voteAverage+releaseDate+originalLanguage+
            status+budget+runtime+revenue+genres+overview;
        var posterPath = imgPth+result.data.poster_path;
        agent.add(new Card({title: "Detalles" ,text: `Mostrando detalles para ${name}`}));
        agent.add(new Card({title: name,imageUrl: posterPath,text: cardText}));
      });
    }

  /*Most Popular Movies*/
  function handleMostPopularMovies(){
     return axios.get(`${endpoint}/movie/popular?api_key=${tmdbKey}&language=es&page=1`)
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
                var originalLanguage= movie.original_language==""?"":"Idioma original: "+movie.original_language+"\n"; 
                var overview = movie.overview==""?"":"Resumen: "+movie.overview;
                var cardText=voteAverage+releaseDate+originalLanguage+overview;
                var posterPath = imgPth+movie.poster_path;
                agent.add(new Card({title: name,imageUrl: posterPath,text: cardText, buttonText: `Ver detalles`,
                    buttonUrl: `${name} (movie:${mediaid})`}));
              }
           });
         }else{
			agent.add(new Card({title: "Sin resultados" , text: `Ahora no hay películas populares. Vuelve a intentarlo en otro momento.`}));
         }
     });
  }
  
  /*Display details: Visualize Most Popular Movies Details*/
  function handleMostPopularMoviesDetails(){
    var mediaelement = agent.parameters.mediaelement;
    var mediaid = agent.parameters.mediaid;
    /*Movie Details*/
    return axios.get(`${endpoint}/movie/${mediaid}?api_key=${tmdbKey}&language=es`)
      .then((result)=>{
        var movie = result.data;
        var name= movie.title;
        var tagline= movie.tagline;
        var voteAverage = movie.vote_average==0?"":"Puntuación media: "+movie.vote_average+"\n";
        var releaseDate = movie.release_date==null?"":"Fecha de estreno: "+movie.release_date+"\n";
        var originalLanguage = "Idioma original: "+movie.original_language+"\n";
        var status;
        if(movie.status=="Released"){status="Estado: Estrenada \n";}
        if(movie.status=="Post Production"){status="Estado: Post-Producción \n";}
        if(movie.status=="In Production"){status="Estado: En Producción \n";}
        if(movie.status=="Planned"){status="Estado: Planeada \n";}
        var runtime = movie.runtime==0?"":"Duración: "+movie.runtime+" minutos \n";
        var budget= movie.budget==0?"":"Presupuesto: "+movie.budget+"\n";
        var revenue = movie.revenue==0?"":"Recaudado: "+movie.revenue+"\n";
        var homepage = movie.homepage==""?"":"Página oficial: "+movie.homepage+"\n";
        var overview = movie.overview==""?"":"Resumen: "+movie.overview+"\n";
        var genres = movie.genres.length>0?"Géneros: \n":"";
        result.data.genres.map((genre) => {genres = genres+genre.name+"\n";});
        var cardText = tagline+voteAverage+releaseDate+originalLanguage+
            status+budget+runtime+revenue+genres+overview;
        var posterPath = imgPth+result.data.poster_path;
        agent.add(new Card({title: "Detalles" ,text: `Mostrando detalles para ${name}`}));
        agent.add(new Card({title: name,imageUrl: posterPath,text: cardText}));
      });
  }
  
  /*Top Rated Movies*/
  function handleTopRatedMovies(){
     return axios.get(`${endpoint}/movie/top_rated?api_key=${tmdbKey}&language=es&page=1`)
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
                var originalLanguage= movie.original_language==""?"":"Idioma original: "+movie.original_language+"\n"; 
                var overview = movie.overview==""?"":"Resumen: "+movie.overview;
                var cardText=voteAverage+releaseDate+originalLanguage+overview;
                var posterPath = imgPth+movie.poster_path;
                agent.add(new Card({title: name,imageUrl: posterPath,text: cardText, buttonText: `Ver detalles`,
                    buttonUrl: `${name} (movie:${mediaid})`}));
              }
            });
         }else{
            agent.add(new Card({title: "Sin resultados" , text: `Ahora mismo no hay películas mejor valoradas. Vuelve a intentarlo en otro momento`}));
         }
     });
  }
  
  /*Display details: Visualize Top Rated Movies Details*/
  function handleTopRatedMoviesDetails(){
    var mediaelement = agent.parameters.mediaelement;
    var mediaid = agent.parameters.mediaid;
    /*Movie Details*/
    return axios.get(`${endpoint}/movie/${mediaid}?api_key=${tmdbKey}&language=es`)
      .then((result)=>{
        var movie = result.data;
        var name= movie.title;
        var tagline= movie.tagline;
        var voteAverage = movie.vote_average==0?"":"Puntuación media: "+movie.vote_average+"\n";
        var releaseDate = movie.release_date==null?"":"Fecha de estreno: "+movie.release_date+"\n";
        var originalLanguage = "Idioma original: "+movie.original_language+"\n";
        var status;
        if(movie.status=="Released"){status="Estado: Estrenada \n";}
        if(movie.status=="Post Production"){status="Estado: Post-Producción \n";}
        if(movie.status=="In Production"){status="Estado: En Producción \n";}
        if(movie.status=="Planned"){status="Estado: Planeada \n";}
        var runtime = movie.runtime==0?"":"Duración: "+movie.runtime+" minutos \n";
        var budget= movie.budget==0?"":"Presupuesto: "+movie.budget+"\n";
        var revenue = movie.revenue==0?"":"Recaudado: "+movie.revenue+"\n";
        var homepage = movie.homepage==""?"":"Página oficial: "+movie.homepage+"\n";
        var overview = movie.overview==""?"":"Resumen: "+movie.overview+"\n";
        var genres = movie.genres.length>0?"Géneros: \n":"";
        result.data.genres.map((genre) => {genres = genres+genre.name+"\n";});
        var cardText = tagline+voteAverage+releaseDate+originalLanguage+
            status+budget+runtime+revenue+genres+overview;
        var posterPath = imgPth+result.data.poster_path;
        agent.add(new Card({title: "Detalles" ,text: `Mostrando detalles para ${name}`}));
        agent.add(new Card({title: name,imageUrl: posterPath,text: cardText}));
      });
  }
  
  /*Media Release Date*/
  function handleSearchMediaDate(){
    const medianame = agent.parameters.medianame;
    var arrayName = medianame.split(" ");
    var queryName = arrayName.join('-');
    return axios.get(`${endpoint}/search/multi?api_key=${tmdbKey}&query=${queryName}&page=1&include_adult=false&language=es`)
      .then((result)=>{
      if(result.data.results.length>0){
        var element = result.data.results[0];
        var mediaType=element.media_type;
        var posterPath = element.backdrop_path==null?"":imgPth+element.backdrop_path;
        if(mediaType=="tv"){
          var name = element.name;
          var airDate = element.first_air_date;
          agent.add(new Card({title: "Fecha de estreno" ,imageUrl: posterPath,text: `La fecha de estreno de la serie ${name} es ${airDate}`}));
        }
        if(mediaType=="movie"){
          var title = element.title;
          var releaseDate = element.release_date;
          agent.add(new Card({title: "Fecha de estreno" ,imageUrl: posterPath,text: `La fecha de estreno de la pelicula ${title} es ${releaseDate}`}));
        }
      }else{
        agent.add(new Card({title: "Sin resultados" , text: `No se han encontrado resultados para ${medianame}. Vuelve a intentarlo`}));
      }
    });
  }
  
  /*Media Rating*/
  function handleSearchMediaRating(){
    const medianame = agent.parameters.medianame;
    var arrayName = medianame.split(" ");
    var queryName = arrayName.join('-');
    console.log("QUERY",queryName);
    return axios.get(`${endpoint}/search/multi?api_key=${tmdbKey}&query=${queryName}&page=1&include_adult=false&language=es`)
      .then((result)=>{
      if(result.data.results.length>0){
        var element = result.data.results[0];
        var mediaType=element.media_type;
        var rating = element.vote_average;
        var posterPath = element.backdrop_path==null?"":imgPth+element.backdrop_path;
        if(mediaType=="tv"){
          var name = element.name;
          agent.add(new Card({title: "Puntuación media" ,imageUrl: posterPath,text: `La puntuación media de la serie ${name} es ${rating} sobre 10 puntos.`}));
        }
        if(mediaType=="movie"){
          var title = element.title;
          agent.add(new Card({title: "Puntuación media" ,imageUrl: posterPath,text: `La puntuación media de la pelicula ${title} es ${rating} sobre 10 puntos.`}));
        }
      }else{
        agent.add(new Card({title: "Sin resultados" , text: `No se han encontrado resultados para ${medianame}. Vuelve a intentarlo`}));
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
      if(result.data.results.length>0){
        var element = result.data.results[0];
        var mediaType=element.media_type;
        var overview = element.overview;
        var posterPath = element.backdrop_path==null?"":imgPth+element.backdrop_path;
        if(mediaType=="tv"){
          var name = element.name;
          if(overview!=""){
            agent.add(new Card({title: `Sipnosis de la serie ${name}`,imageUrl: posterPath,text: `${overview}`}));
          }else{
            agent.add(new Card({title: `Sipnosis`,imageUrl: posterPath,text: `La serie ${name} no tiene sipnosis.`}));
          }
        }
        if(mediaType=="movie"){
          var title = element.title;
          if(overview!=""){
            agent.add(new Card({title: `Sipnosis de la película ${title}`,imageUrl: posterPath,text: `${overview}`}));
          }else{
            agent.add(new Card({title: `Sipnosis`,imageUrl: posterPath,text: `La película ${title} no tiene sipnosis.`}));
          }
        }
      }else{
        agent.add(new Card({title: "Sin resultados" , text: `No se han encontrado resultados para ${medianame}. Vuelve a intentarlo`}));
      }
    });
  }
  
  /*Media Cast*/
   function handleMediaCast(){
    var medianame =agent.parameters.medianame;
    var query = agent.query;
    var arrayName = medianame.split(" ");
    var queryName = arrayName.join('-');
    /*Not specified movie o series*/
    return axios.get(`${endpoint}/search/multi?api_key=${tmdbKey}&query=${queryName}&page=1&include_adult=false&language=es`)
      .then((result)=>{
        if(result.data.results.length>0){
          var element = result.data.results[0];
          var name = element.name;
          var mediaTp=element.media_type;
          var mediaid = element.id;
          if(mediaTp == "movie"){
            return axios.get(`${endpoint}/movie/${mediaid}/credits?api_key=${tmdbKey}&language=es`)
      		.then((credits)=>{
              if(credits.data.cast.length>0){
                var credit = credits.data.cast[0];
                var count = 0;
                credits.data.cast.map((credit) =>{
                  if(count<6){
                    count++;
                    var posterPath =imgPth+credit.profile_path;
                    agent.add(new Card({title: "Personaje: "+credit.character,imageUrl: posterPath,text: credit.name}));
                  }
                });
              }else{agent.add(`No se encuentra el reparto de ${medianame}`);}
            });
          }
          if(mediaTp=="tv"){
            return axios.get(`${endpoint}/tv/${mediaid}/credits?api_key=${tmdbKey}&language=es`)
      		.then((credits)=>{
              if(credits.data.cast.length>0){
                var credit = credits.data.cast[0];
                var count = 0;
                credits.data.cast.map((credit) =>{
                  if(count<6){
                    count++;
                    var posterPath =imgPth+credit.profile_path;
                    agent.add(new Card({title: "Personaje: "+credit.character,imageUrl: posterPath,text: credit.name}));
                  }
                });
              }else{agent.add(`No se encuentra el reparto de ${medianame}`);}
            });
          }
        }else{agent.add(new Card({title: "Sin resultados" , text: `No se han encontrado resultados para ${medianame}. Vuelve a intentarlo`}));
       }
      });
    }
  
  /*Movie Info: Movie Cast*/
  function handleMovieCast(){
  var medianame =agent.parameters.medianame;
  var arrayName = medianame.split(" ");
  var queryName = arrayName.join('-');
  return axios.get(`${endpoint}/search/movie?api_key=${tmdbKey}&query=${queryName}&page=1&include_adult=false&language=es`)
      .then((result)=>{
     if(result.data.results.length>0){
      var element = result.data.results[0];
      var movieId = element.id;
      var name = element.title;
      var posterPath = imgPth+element.poster_path;
      agent.add(new Card({title: `Reparto`,imageUrl: posterPath,text: `El reparto de ${name} es:`}));
      return axios.get(`${endpoint}/movie/${movieId}/credits?api_key=${tmdbKey}&language=es`)
      .then((credits)=>{
        if(credits.data.cast.length>0){
        var credit = credits.data.cast[0];
        var count = 0;
        credits.data.cast.map((credit) =>{
          if(count<6){
            count++;
            var posterPath =imgPth+credit.profile_path;
            agent.add(new Card({
               title: "Personaje: "+credit.character,
               imageUrl: posterPath,
               text: credit.name}));
          }
        });
       }else{agent.add(`No se ha encontrado el reparto de ${name}`);}
      });
     }else{
       agent.add(new Card({title: "Sin resultados" , text: `No se han encontrado resultados para ${medianame}. Vuelve a intentarlo`}));
     }
    });
  }
  
  /*Series Cast*/
  function handleTvCast(){
    var medianame =agent.parameters.medianame;
    var arrayName = medianame.split(" ");
    var queryName = arrayName.join('-');
    return axios.get(`${endpoint}/search/tv?api_key=${tmdbKey}&query=${queryName}&page=1&include_adult=false&language=es`)
      .then((result)=>{ 
      if(result.data.results.length>0){
      var element = result.data.results[0];
      var tvId = element.id;
      var name = element.name;
      return axios.get(`${endpoint}/tv/${tvId}/credits?api_key=${tmdbKey}&language=es`)
      .then((credits)=>{
        if(credits.data.cast.length>0){
        var credit = credits.data.cast[0];
        var count = 0;
        credits.data.cast.map((credit) =>{
          if(count<6){
            count++;
            var posterPath =imgPth+credit.profile_path;
            agent.add(new Card({
               title: "Personaje: "+credit.character,
               imageUrl: posterPath,
               text: credit.name}));
          }
        });
       }else{agent.add(`No se ha encontrado el reparto de ${name}`);}
      });
     }else{agent.add(new Card({title: "Sin resultados" , text: `No se han encontrado resultados para ${medianame}. Vuelve a intentarlo`}));}
    }); 
  }
  
  /*Media Directors*/
  function handleSearchMediaDirectors(){
    var medianame =agent.parameters.medianame;
    var arrayName = medianame.split(" ");
    var queryName = arrayName.join('-');
    return axios.get(`${endpoint}/search/multi?api_key=${tmdbKey}&query=${queryName}&page=1&include_adult=false&language=es`)
    .then((result)=>{
        if(result.data.results.length>0){
          var element = result.data.results[0];
          var mediaid = element.id;
          var mediatype= element.media_type;
      	  var name = element.name==undefined?element.title:element.name;
          var posterPath = element.backdrop_path==null?"":imgPth+element.backdrop_path;
          console.log("POSTER: ", posterPath);
          if(mediatype=="movie"){
            return axios.get(`${endpoint}/movie/${mediaid}/credits?api_key=${tmdbKey}&language=es`)
      		.then((credits)=>{
              if(credits.data.crew.length>0){
                var cardText = "";
                credits.data.crew.map((credit)=>{if(credit.job=="Director"){cardText=cardText+" "+credit.name;}});
                agent.add(new Card({title: "Directores" ,imageUrl: posterPath, text: `Los directores de ${name}: ${cardText}`}));
              }else{agent.add(`No se han podido encontrar los directores para ${name}`);}
            });
          }
          if(mediatype=="tv"){
            return axios.get(`${endpoint}/tv/${mediaid}/credits?api_key=${tmdbKey}&language=es`)
      		.then((credits)=>{
               if(credits.data.crew.length>0){
                var cardText = "";
                credits.data.crew.map((credit)=>{if(credit.job=="Director"||credit.job=="Executive Producer"){cardText=cardText+" "+credit.name;}});
                agent.add(new Card({title: "Directores" ,imageUrl:posterPath, text: `Los directores de ${name}: ${cardText}`}));
               }
            });
          }
        }else{
          agent.add(new Card({title: "Sin resultados" , text: `No se han encontrado resultados para ${medianame}. Vuelve a intentarlo`}));
        }
    });
  }
  
  /*Movie Directors*/
  function handleSearchMovieDirectors(){
    var medianame =agent.parameters.medianame;
    var arrayName = medianame.split(" ");
    var queryName = arrayName.join('-');
    return axios.get(`${endpoint}/search/movie?api_key=${tmdbKey}&query=${queryName}&page=1&include_adult=false&language=es`)
      .then((result)=>{
      if(result.data.results.length>0){
      var element = result.data.results[0];
      var movieId = element.id;
      var name = element.name;
      var posterPath = element.backdrop_path==null?"":imgPth+element.backdrop_path;
      return axios.get(`${endpoint}/movie/${movieId}/credits?api_key=${tmdbKey}&language=es`)
      .then((credits)=>{
        var cardText="";
        if(credits.data.crew.length>0){
          credits.data.crew.map((credit) =>{if(credit.job=="Director"){cardText = cardText+" "+credit.name;}});
          agent.add(new Card({title: "Directores" , imageUrl:posterPath,text: `Los directores de ${name}: ${cardText}`}));
       }else{agent.add(`No se encuentran directores para ${name}`);}
      });
     }else{agent.add(new Card({title: "Sin resultados" , text: `No se han encontrado resultados para ${medianame}. Vuelve a intentarlo`}));}
    });
  }
  
  /*Tv Directors*/
  function handleSearchTvDirectors(){
    var medianame =agent.parameters.medianame;
    var arrayName = medianame.split(" ");
    var queryName = arrayName.join('-');
    return axios.get(`${endpoint}/search/tv?api_key=${tmdbKey}&query=${queryName}&page=1&include_adult=false&language=es`)
      .then((result)=>{
      if(result.data.results.length>0){
      var element = result.data.results[0];
      var tvId = element.id;
      var name = element.name;
      var posterPath = element.backdrop_path==null?"":imgPth+element.backdrop_path;
      return axios.get(`${endpoint}/tv/${tvId}/credits?api_key=${tmdbKey}&language=es`)
      .then((credits)=>{
        if(credits.data.crew.length>0){
        var cardText="";
        credits.data.crew.map((credit) =>{if(credit.job=="Director"){cardText=cardText+" "+credit.name;}});
        agent.add(new Card({title: "Directores" ,imageUrl:posterPath, text: `Los directores de ${name}: ${cardText}`}));
        }else{agent.add(`No se encontraron directores para ${name}`);}
      });
     }else{agent.add(new Card({title: "Sin resultados" , text: `No se han encontrado resultados para ${medianame}. Vuelve a intentarlo`}));}
    });
  }
  
  /*Media Language*/
  function handleSearchMediaLanguage(){
    const medianame = agent.parameters.medianame;
    var arrayName = medianame.split(" ");
    var queryName = arrayName.join('-');
    return axios.get(`${endpoint}/search/multi?api_key=${tmdbKey}&query=${queryName}&page=1&include_adult=false&language=es`)
      .then((result)=>{
      if(result.data.results.length>0){
        var element = result.data.results[0];
        var mediaType=element.media_type;
        var originalLanguage = element.original_language;
        var posterPath = element.backdrop_path==null?"":imgPth+element.backdrop_path;
        if(mediaType=="tv"){
          var name = element.name;
          agent.add(new Card({title: "Idioma original" ,imageUrl:posterPath, text: `El idioma original de la serie ${name} es ${originalLanguage}`}));
        }
        if(mediaType=="movie"){
          var title = element.title;
          agent.add(new Card({title: "Idioma original" ,imageUrl:posterPath, text: `El idioma original de la película ${title} es ${originalLanguage}`}));
        }
      }else{agent.add(new Card({title: "Sin resultados" , text: `No se han encontrado resultados para ${medianame}. Vuelve a intentarlo`}));}
    });
  }
  
  /*Tv Number of Seasons*/
  function handleSearchTvSeasons(){
    var medianame =agent.parameters.medianame;
    var arrayName = medianame.split(" ");
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
        var name = serie.name;
       	var numberSeasons = serie.number_of_seasons;
       	var numberEpisodes = serie.number_of_episodes;
        var posterPath = element.backdrop_path==null?"":imgPth+element.backdrop_path;
		agent.add(new Card({title: "Temporadas y episodios" ,imageUrl:posterPath, text: `El número de temporadas de la serie ${name} es ${numberSeasons}. En total tiene ${numberEpisodes} episodios.`}));
        }
        });
      }else{agent.add(new Card({title: "Sin resultados" , text: `No se han encontrado resultados para ${medianame}. Vuelve a intentarlo`}));}
     });
  }

  /*Media networks*/
  function handleSearchNetworks(){
   	var medianame =agent.parameters.medianame;
    var arrayName = medianame.split(" ");
    var queryName = arrayName.join('-');
    return axios.get(`${endpoint}/search/multi?api_key=${tmdbKey}&query=${queryName}&page=1&include_adult=false&language=es`)
      .then((result)=>{
      if(result.data.results.length>0){
        var element = result.data.results[0];
        var id = element.id;
        var mediaelement = element.media_type;
      return axios.get(`https://www.themoviedb.org/${mediaelement}/${id}-${queryName}/watch?language=es`)
      .then((response)=>{
      const $ = cheerio.load(response.data);
      var providers = $('.right_column').children('div.ott_provider').first().find('ul.providers').children('.ott_filter_best_price');
      if(providers.length>0){
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
      });
        if(count==0){agent.add(new Card({title: "Sin resultados" , text: `No hay plataformas disponibles para visualizar ${medianame}`}));}
      }else{agent.add(new Card({title: "Sin resultados" , text: `No hay plataformas disponibles para visualizar ${medianame}`}));}
    });
      }else{agent.add(new Card({title: "Sin resultados" , text: `No se han encontrado resultados para ${medianame}. Vuelve a intentarlo`}));}
    });
  }
  
   /*Media genres*/
  function handleSearchMediaGenres(){
    var medianame =agent.parameters.medianame;
    var arrayName = medianame.split(" ");
    var queryName = arrayName.join('-');
     return axios.get(`${endpoint}/search/multi?api_key=${tmdbKey}&query=${queryName}&page=1&include_adult=false&language=es`)
      .then((result)=>{
        if(result.data.results.length>0){
          var type = element.media_type;
          var element = result.data.results[0];
          var elementname = type=="tv"?element.name:element.title;
          var mediaid = element.id;
          var posterPath = imgPth+element.backdrop_path;
          return axios.get(`${endpoint}/${type}/${mediaid}?api_key=${tmdbKey}&language=es`)
      		.then((media)=>{
            if(media!=null){
              var cardText = "Los géneros de "+elementname+" son: ";
              media.data.genres.map((genre)=>{cardText=cardText+genre.name+" ";});
              agent.add(new Card({title: `Géneros de ${elementname}` , text: `${cardText}`, imageUrl: posterPath}));
            }else{agent.add(new Card({title: "Sin resultados" , text: `No se han encontrado resultados para ${medianame}. Vuelve a intentarlo`}));}
          });
        }else{agent.add(new Card({title: "Sin resultados" , text: `No se han encontrado resultados para ${medianame}. Vuelve a intentarlo`}));}
     });
  }

  /*Original title*/
  function handleSearchMediaOriginalTitle(){
    var medianame =agent.parameters.medianame;
    var arrayName = medianame.split(" ");
    var queryName = arrayName.join('-');
    return axios.get(`${endpoint}/search/multi?api_key=${tmdbKey}&query=${queryName}&page=1&include_adult=false&language=es`)
      .then((result)=>{
      if(result.data.results.length>0){
      var element = result.data.results[0];
      var mediaType = element.media_type;
      var title = mediaType == "tv"?element.name:element.title;
      var originalTitle= mediaType=="tv"?element.original_name:element.original_title;
      var translation = mediaType == "tv"?"serie":"película";
      var posterPath = imgPth+element.backdrop_path;
      var cardText = "El título original de la "+translation+" es "+originalTitle;
      agent.add(new Card({title: `Título original de ${title}` , text: `${cardText}`, imageUrl: posterPath}));
     }else{agent.add(new Card({title: "Sin resultados" , text: `No se han encontrado resultados para ${medianame}. Vuelve a intentarlo`}));}
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
  
  /*Official web page of series or movie*/
  function handleSearchMediaOfficialPage(){
    var medianame =agent.parameters.medianame;
    var arrayName = medianame.split(" ");
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
           agent.add(new Card({title: `Página web de ${elementname}`,imageUrl: posterPath,text:`La página web de la ${translation} ${elementname} es ${homepage}`}));
           }else{agent.add(`La ${translation} ${elementname} no tiene página web`);}         
         }else{agent.add(new Card({title: "Sin resultados" , text: `No se han encontrado resultados para ${medianame}. Vuelve a intentarlo`}));}
       });
      }else{agent.add(new Card({title: "Sin resultados" , text: `No se han encontrado resultados para ${medianame}. Vuelve a intentarlo`}));}
     });
  }
  
 /*Searching similar media*/
 function handleSearchSimilarMedia(){
    var medianame =agent.parameters.medianame;
    var arrayName = medianame.split(" ");
    var queryName = arrayName.join('-');
    return axios.get(`${endpoint}/search/multi?api_key=${tmdbKey}&query=${queryName}&page=1&include_adult=false&language=es`)
    .then((result)=>{
       if(result.data.results.length>0){
         var element = result.data.results[0];
         var elementid = element.id;
         var type = element.media_type;
         var translation = type=="tv"?"serie":"película";
         var elementname = type =="tv"?element.name:element.title;
         var backdropPath = imgPth+element.backdrop_path;
         agent.add(new Card({title: "Similares a "+elementname,imageUrl: backdropPath, text:`Resultados:`}));
         return axios.get(`${endpoint}/${type}/${elementid}/similar?api_key=${tmdbKey}&language=es&page=1`)
      		.then((media)=>{
             if(media!=null){
               var count = 0;
               media.data.results.map((element)=>{
               if(count<4){
               	count++;
                var name = type=="tv"?element.name:element.title;
                var posterPath = imgPth+element.poster_path;
                var overview = element.overview==""?"":"Resumen:\n"+element.overview;
                var releasedate = type=="tv"?element.first_air_date:element.release_date;
                var cardText="Fecha de estreno: "+releasedate+"\n"+overview;
                agent.add(new Card({title: name+" ("+translation+")",imageUrl: posterPath, text:cardText}));
               }
              });
             }else{agent.add(new Card({title: "Sin resultados" , text: `No se han encontrado resultados para ${medianame}. Vuelve a intentarlo`}));}
         });
       }else{agent.add(new Card({title: "Sin resultados" , text: `No se han encontrado resultados para ${medianame}. Vuelve a intentarlo`}));}
    });
  }

  /*Age recommendation for movie or series*/
  function handleSearchMediaIsAdult(){
    var medianame =agent.parameters.medianame;
    var arrayName = medianame.split(" ");
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
      var certification;
      return axios.get(`https://www.themoviedb.org/${type}/${elementid}-${queryName}?language=es`)
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
      agent.add(new Card({title:`Calificación de edad de ${elementname}`,text:`${meaning} `,imageUrl:posterPath}));  
      });
     }else{agent.add(new Card({title: "Sin resultados" , text: `No se han encontrado resultados para ${medianame}. Vuelve a intentarlo`}));}
    });
  }

  /*Popular movies of actor*/
  function handleSearchActorPopularMovies(){
    var medianame =agent.parameters.medianame.toLowerCase();
    var arrayName = medianame.split(" ");
    var queryName = arrayName.join('-');
    return axios.get(`${endpoint}/search/person?api_key=${tmdbKey}&query=${queryName}&language=es&page=1&include_adult=true`)
    .then((result)=>{
      if(result.data.results.length>0){
        var element = result.data.results[0];
        var personId = element.id;
        var personName = element.name;
        var posterPath = imgPth+element.profile_path; 
        return axios.get(`${endpoint}/person/${personId}/movie_credits?api_key=${tmdbKey}&language=es&sort_by=popularity.desc`)
        .then((credits)=>{
          if(credits.data.cast.length>0){
            agent.add(new Card({title: `Películas de ${personName}`,imageUrl: posterPath,text: `Estas son algunas películas de ${personName}`}));
            var count = 0;
            credits.data.cast.map((movie)=>{
            if(count<12){
              count++;
              var name = movie.title;
              var posterPath = imgPth+movie.poster_path;
              var character = movie.character==""?"":personName+" interpreta a "+movie.character+"\n";
              var voteAverage = movie.vote_average==0?"":"Puntuación media: "+movie.vote_average+"\n";
              var releaseDate = "Fecha de estreno: "+movie.release_date+"\n";
              var overview = movie.overview==""?"":"Resumen: "+movie.overview;
              var cardText=character+voteAverage+releaseDate+overview;
              agent.add(new Card({title: name,imageUrl: posterPath,text: cardText}));
            }
          });
         }else{agent.add(new Card({title: "Sin resultados" , text: `No se han encontrado resultados para ${medianame}. Vuelve a intentarlo`}));}
       });
      }else{agent.add(new Card({title: "Sin resultados" , text: `No se han encontrado resultados para ${medianame}. Vuelve a intentarlo`}));}
  });
}
  
  /*Popular shows of actor*/
  function handleSearchActorPopularTvShows(){
    var medianame =agent.parameters.medianame.toLowerCase();
    var arrayName = medianame.split(" ");
    var queryName = arrayName.join('-');
    return axios.get(`${endpoint}/search/person?api_key=${tmdbKey}&query=${queryName}&language=es&page=1&include_adult=true`)
    .then((result)=>{
      if(result.data.results.length>0){
        var element = result.data.results[0];
        var personId = element.id;
        var personName = element.name;
        var posterPath = imgPth+element.profile_path; 
        return axios.get(`${endpoint}/person/${personId}/tv_credits?api_key=${tmdbKey}&language=es&sort_by=popularity.desc`)
        .then((credits)=>{
          if(credits.data.cast.length>0){
            agent.add(new Card({title: `Series de ${personName}`,imageUrl: posterPath,text: `Algunas series famosas de ${personName} son:`}));
            var count = 0;
            credits.data.cast.map((serie)=>{
            if(count<12){
              count++;
              var name = serie.name;
              var posterPath = imgPth+serie.poster_path;
              var character = serie.character==""?"":personName+" interpreta a "+serie.character+"\n";
              character = serie.character.trim()=="Herself"?"Como ella misma":personName+" interpreta a "+serie.character+"\n";
              character = serie.character.trim()=="Himself"?"Como él mismo":personName+" interpreta a "+serie.character+"\n";
              var voteAverage = serie.vote_average==0?"":"Puntuación media: "+serie.vote_average+"\n";
              var releaseDate = "Fecha de estreno: "+serie.first_air_date+"\n";
              var episodes = serie.episode_count==0?"":"Aparece en "+serie.episode_count+" episodios \n";
              var overview = serie.overview==""?"":"Resumen: "+serie.overview;
              var cardText=character+voteAverage+releaseDate+episodes+overview;
              agent.add(new Card({title: name,imageUrl: posterPath,text: cardText}));
            }
          });
         }else{agent.add(new Card({title: "Sin resultados" , text: `No se han encontrado resultados para ${medianame}. Vuelve a intentarlo`}));}
       });
      }else{agent.add(new Card({title: "Sin resultados" , text: `No se han encontrado resultados para ${medianame}. Vuelve a intentarlo`}));}
    });
  }
  
  /*Searching media reviews*/
  function handleSearchMediaReviews(){
    var medianame =agent.parameters.medianame;
    var arrayName = medianame.split(" ");
    var queryName = arrayName.join('-');
    return axios.get(`${endpoint}/search/multi?api_key=${tmdbKey}&query=${queryName}&page=1&include_adult=false&language=es`)
      .then((result)=>{
      if(result.data.results.length>0){
        var element = result.data.results[0];
        var elementid = element.id;
        var type = element.media_type;
        var translation = type=="tv"?"serie":"película";
        var posterPath = imgPth+element.poster_path;
        var elementname = type=="tv"?element.name:element.title;
        return axios.get(`${endpoint}/${type}/${elementid}/reviews?api_key=${tmdbKey}&language=es&page=1`)
      	.then((reviews)=>{
          if(reviews.data.results.length>0){
           agent.add(new Card({title: "Reseñas para la "+type+" "+elementname,imageUrl:posterPath,text: "Estas son algunas reseñas: "}));
           reviews.data.results.map((review)=>{ 
             var reviewAuthor = review.author;
             var content = review.content;
             agent.add(new Card({title: "Reseña de "+reviewAuthor,text: ""+content+""}));
           });
          }else{agent.add(new Card({title: "Sin reseñas" , text: `No hay reseñas para ${elementname}.`}));}
        });
      }else{agent.add(new Card({title: "Sin resultados" , text: `No se han encontrado resultados para ${medianame}. Vuelve a intentarlo`}));}
    });
  }
  
  /*Seach actor biography*/
  function handleSearchPersonBiography(){
    var medianame =agent.parameters.medianame;
    var arrayName = medianame.toLowerCase().split(" ");
    var queryName = arrayName.join('-');
    return axios.get(`${endpoint}/search/person?api_key=${tmdbKey}&query=${queryName}&language=es&page=1&include_adult=false`)
      .then((result)=>{
      if(result.data.results.length>0){
      var element = result.data.results[0];
      var personId = element.id;
      return axios.get(`${endpoint}/person/${personId}?api_key=${tmdbKey}&language=es`)
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
          var posterPath=imgPth+person.data.profile_path;
          agent.add(`${personname}`);
          agent.add(new Card({title: cardTitle,imageUrl:posterPath,text: cardText}));
        }else{agent.add(new Card({title: "Sin resultados" , text: `No se han encontrado resultados para ${medianame}. Vuelve a intentarlo`}));}
      });
     }else{agent.add(new Card({title: "Sin resultados" , text: `No se han encontrado resultados para ${medianame}. Vuelve a intentarlo`}));}
    });
  }
  
  /*Birthday and age of a person*/
  function handleSearchPersonBirthdate(){
    var medianame =agent.parameters.medianame;
    var arrayName = medianame.split(" ");
    var queryName = arrayName.join('-');
    return axios.get(`${endpoint}/search/person?api_key=${tmdbKey}&query=${queryName}&language=es&page=1&include_adult=false`)
      .then((result)=>{
      if(result.data.results.length>0){
      var element = result.data.results[0];
      var personId = element.id;
      return axios.get(`${endpoint}/person/${personId}?api_key=${tmdbKey}&language=es`)
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
          agent.add(new Card({title: cardTitle,imageUrl:posterPath,text: cardText}));
        }else{agent.add(new Card({title: "Sin resultados" , text: `No se han encontrado resultados para ${medianame}. Vuelve a intentarlo`}));}
      });
      }else{agent.add(new Card({title: "Sin resultados" , text: `No se han encontrado resultados para ${medianame}. Vuelve a intentarlo`}));}
    });
  }
  
  /*Search Person role in media*/
  function handleSearchPersonRoleInMedia(){
    var medianame =agent.parameters.medianame;
    var personname = agent.parameters.personname;
    var arrayName = personname.split(" ");
    var arrayMovie = medianame.split(" ");
    var queryName = arrayName.join('-');
    var queryMovie = arrayMovie.join('-');
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
    var arrayName = medianame.split(" ");
    var queryName = arrayName.join('-');
    return axios.get(`${endpoint}/search/multi?api_key=${tmdbKey}&query=${queryName}&page=1&include_adult=false&language=es`)
      .then((result)=>{
      if(result.data.results.length>0){
        var element = result.data.results[0];
        var type = element.media_type;
      	var movieId = element.id;
      	var mediaName = type=="tv"?element.name:element.title;
        var posterPath=imgPth+element.backdrop_path;
        if(type=="movie"){
        return axios.get(`${endpoint}/movie/${movieId}?api_key=${tmdbKey}`)
      	.then((movie)=>{
          if(movie!=null){
            var runtime = movie.data.runtime;
            var cardText=`La duración de la película ${mediaName} es ${runtime} minutos.`;
            agent.add(new Card({title:`Duración de ${mediaName}`,text:cardText,imageUrl:posterPath}));
          }else{agent.add(new Card({title: "Sin resultados" , text: `No se han encontrado resultados para ${medianame}. Vuelve a intentarlo`}));}
       });
      }else{agent.add(new Card({title: `Serie ${mediaName}` ,imageUrl:posterPath, text: `${mediaName} es una serie. Prueba a buscar por número de episodios.`}));}
     }else{agent.add(new Card({title: "Sin resultados" , text: `No se han encontrado resultados para ${medianame}. Vuelve a intentarlo`}));}  
    });
  }
  

  /*Media images*/
  function handleSearchMediaImages(){
    var medianame = agent.parameters.medianame;
    var arrayName = medianame.split(" ");
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
          console.log("IMAGES: "+JSON.stringify(photos.data));
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
            }else{
              if(posters.length>0){
                agent.add(new Card({title:`Posters de ${elementname}`,text:`Estos son algunos posters de ${elementname}`}));
                posters.map((poster)=>{
                  if(count<4){
                  count++;
                  agent.add(new Image(imgPth+poster.file_path));
                  }
                });
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
  
  /*Showtimes: Getting cinemas*/
  function handleSearchIntroduceCity(){
    var city = agent.parameters.city.toLowerCase();
    agent.setContext({ "name": "introduce_city_followup","lifespan":1,"parameters":{"city":city}});  
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
          var cinema = cinemaLink.attr('title');
          agent.add(new Card({title: `${cinema}`,text:`Cine`,buttonText: `Ver cartelera`,    
                         buttonUrl: `(${cinemaRef})`}));
        });
        }
      });
    });
  }
  
  /*Showtimes: Getting Movies*/
  function handleSearchIntroduceCinema(){
    var city = agent.parameters.city;
    var cinemaLink = agent.parameters.cinemalink;
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
        agent.add(`horarios ${movietitle}`);
        agent.add(new Card({title: `${movietitle}`,text:`${movietext}`,imageUrl:image,
            buttonText: `Ver horarios para ${movietitle}`, buttonUrl: `horarios ${movietitle}`}));
      });
    });
  }
  
  /*Showtimes at a cinema*/
  function handleMovieShowtimesAtCinema(){
    var cinemaLink = agent.parameters.cinemalink;
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
        var movietitle = movieinfo.find('h3').text().toLowerCase();   
        if(movietitle.trim() == moviename.toLowerCase().trim()){
          	var date = arraydates[count];
          	count++;
          	var showtimes = movieinfo.find('ul.pases').children();
          	var textshowtimes = "";
          	showtimes.each((i,el)=>{
              var showtime = $(el).find('span').text();
              textshowtimes = textshowtimes + showtime + "\n";
            });
          agent.add(new Card({title: `Horarios para ${date}`,text:`${textshowtimes}`})); 
        }
    });
   });
  }
  
  /*Introduce a movie to find cinemas*/
  function handleSearchIntroduceMovie(){
    var moviename = agent.parameters.moviename;
    agent.add(`Pelicula: ${moviename}`);
    var moviespath = abcPth+"/play/cine/cartelera/sevilla/";
    return axios.get(`${moviespath}`)
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
    var movieid = agent.parameters.movieid;
    var path = abcPth+"/play/cine/cartelera/cines-donde-ver/pelicula-"+movieid+"/"+cityname;
    return axios.get(`${path}`).then((response)=>{
      const $ = cheerio.load(response.data);
      var cinemas = $('span.contenedor').find('main')
      .find('span.seccion.clear.cine')
      .find('span.tarjeta.w4').children('article');
      cinemas.each((ind, elm)=>{
        var section = $(elm).find('span.info');
        var cinemaname = section.find('h3.nombre-pelicula')
        .find('a').attr('title');
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
  intentMap.set('ViewNowShowingDetails', handleViewNowShowingDetails);
  intentMap.set('SearchMostPopularMovies', handleMostPopularMovies);
  intentMap.set('ViewMostPopularMoviesDetails', handleMostPopularMoviesDetails);
  intentMap.set('SearchTopRatedMovies', handleTopRatedMovies);
  intentMap.set('ViewTopRatedMoviesDetails', handleTopRatedMoviesDetails);
  intentMap.set('SearchMediaDate', handleSearchMediaDate);
  intentMap.set('SearchMediaRating', handleSearchMediaRating);
  intentMap.set('SearchMediaOverview', handleSearchMediaOverview);
  intentMap.set('SearchMediaCast', handleMediaCast);
  intentMap.set('SearchMovieCast', handleMovieCast);
  intentMap.set('SearchTvCast', handleTvCast);
  intentMap.set('SearchMediaDirectors', handleSearchMediaDirectors);
  intentMap.set('SearchMovieDirectors', handleSearchMovieDirectors);
  intentMap.set('SearchTvDirectors', handleSearchTvDirectors);
  intentMap.set('SearchMediaLanguage', handleSearchMediaLanguage);
  intentMap.set('SearchTvSeasons', handleSearchTvSeasons);
  intentMap.set('SearchNetworks', handleSearchNetworks);
  intentMap.set('SearchMediaGenres', handleSearchMediaGenres);
  intentMap.set('SearchMediaOriginalTitle', handleSearchMediaOriginalTitle);
  intentMap.set('SearchTvVideos', handleSearchTvVideos);
  intentMap.set('SearchMovieVideos', handleSearchMovieVideos);
  intentMap.set('SearchMediaOfficialPage', handleSearchMediaOfficialPage);
  intentMap.set('SearchSimilarMedia', handleSearchSimilarMedia);
  intentMap.set('SearchMediaIsAdult', handleSearchMediaIsAdult);
  intentMap.set('SearchActorPopularMovies', handleSearchActorPopularMovies);
  intentMap.set('SearchActorPopularTvShows', handleSearchActorPopularTvShows);
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
  agent.handleRequest(intentMap);
});
