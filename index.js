'use strict';

const bodyParser = require('body-parser');
const crypto = require('crypto');
const express = require('express');
const fetch = require('node-fetch');
const axios = require('axios');
const { response } = require('express');

let Wit = null;
let log = null;
try {
  Wit = require('../').Wit;
  log = require('../').log;
} catch (e) {
  Wit = require('node-wit').Wit;
  log = require('node-wit').log;
}

// Webserver parameter
const PORT = process.env.PORT || 8445;

// Wit.ai parameters
const WIT_TOKEN = process.env.WIT_TOKEN;

// Nomics API parameter
const NOMICS_API_KEY = process.env.NOMICS_API_KEY;

// Alpha Vantage API parameter
const STOCK_API_KEY = process.env.STOCK_API_KEY;

// Messenger API parameters
const FB_PAGE_TOKEN = process.env.FB_PAGE_TOKEN;
if (!FB_PAGE_TOKEN) { throw new Error('missing FB_PAGE_TOKEN') }
const FB_APP_SECRET = process.env.FB_APP_SECRET;
if (!FB_APP_SECRET) { throw new Error('missing FB_APP_SECRET') }

let FB_VERIFY_TOKEN = null;
crypto.randomBytes(8, (err, buff) => {
  if (err) throw err;
  FB_VERIFY_TOKEN = buff.toString('hex');
  console.log(`/webhook will accept the Verify Token "${FB_VERIFY_TOKEN}"`);
});

const fbMessage = (messageData) => {
  const body = JSON.stringify(messageData);
  console.log("mssdata " + body);

  const qs = 'access_token=' + encodeURIComponent(FB_PAGE_TOKEN);
  return fetch('https://graph.facebook.com/me/messages?' + qs, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body,
  })
  .then(rsp => rsp.json())
  .then(json => {
    if (json.error && json.error.message) {
      throw new Error(json.error.message);
    }
    return json;
  });
};

const sessions = {};

const findOrCreateSession = (fbid) => {
  let sessionId;
  // Let's see if we already have a session for the user fbid
  Object.keys(sessions).forEach(k => {
    if (sessions[k].fbid === fbid) {
      // Yep, got it!
      sessionId = k;
    }
  });
  if (!sessionId) {
    // No session found for user fbid, let's create a new one
    sessionId = new Date().toISOString();
    sessions[sessionId] = {fbid: fbid, context: {}};
  }
  return sessionId;
};

// Setting up our bot
const wit = new Wit({
  accessToken: WIT_TOKEN,
  logger: new log.Logger(log.INFO)
});

// Starting our webserver and putting it all together
const app = express();
app.use(({method, url}, rsp, next) => {
  rsp.on('finish', () => {
    console.log(`${rsp.statusCode} ${method} ${url}`);
  });
  next();
});
app.use(bodyParser.json({ verify: verifyRequestSignature }));

// Webhook setup
app.get('/', (req, res) => {
  if (req.query['hub.mode'] === 'subscribe' &&
    req.query['hub.verify_token'] === FB_VERIFY_TOKEN) {
    res.send(req.query['hub.challenge']);
  } else {
    res.sendStatus(400);
  }
});

// Message handler
app.post('/', (req, res) => {
  const data = req.body;

  if (data.object === 'page') {
    data.entry.forEach(entry => {
      entry.messaging.forEach(event => {
        if (event.message && !event.message.is_echo) {
          // Yay! We got a new message!
          // We retrieve the Facebook user ID of the sender
          const sender = event.sender.id;

          // We could retrieve the user's current session, or create one if it doesn't exist
          // This is useful if we want our bot to figure out the conversation history
          // const sessionId = findOrCreateSession(sender);

          // We retrieve the message content
          const {text, attachments} = event.message;

          if (attachments) {
            // We received an attachment
            // Let's reply with an automatic message
            sendTextMessage(sender, 'Sorry I can only process text messages for now.')
            .catch(console.error);
          } else if (text) {
            // We received a text message
            // Let's run /message on the text to extract some entities, intents and traits
            let elements = [];
            wit.message(text).then(({entities, intents, traits}) => {
              // You can customize your response using these
              console.log(intents);
              console.log(entities);
              console.log(traits);

              const greetings = firstTraitValue(traits, 'wit$greetings');
              const byegreeting = firstTraitValue(traits, 'wit$bye');
              const entite = firstEntityValue(entities, 'cryptocurrency:cryptocurrency');
              const fiatCurr = firstEntityValue(entities, 'fiatcurrency:fiatcurrency');
              const entitePrice = firstEntityValue(entities, 'price:price');
              const entiteNum = firstEntityValue(entities, 'wit$number:number');
              const entiteStock = firstEntityValue(entities, 'stock:stock');
              const entiteCompany = firstEntityValue(entities, 'company:company');
              const intent = intentName(intents);

              if (byegreeting) {
                sendTextMessage(sender, "Thank you :)");
              } else if (greetings) {
                sendTextMessage(sender, "*Hi!* You can ask me : \n_\"current price of btc\"_ \n_\"convert 1 btc to inr\"_ \n_\"btc\"_ \n_\"market cap of btc\"_ \n_\"stock price of MSFT\"_\n*only cryptocurrency and company symbol supported e.g btc, eth, ibm, msft*");
              } else if(entite && !entitePrice && !entiteNum && !entiteStock) {
                // this to get detail of cryptocurrency using symbol/name
                  makeRequest(entite.toUpperCase(), 'USD')
                  .then(function(response) {
                  //   let element = {
                  //     "title": response[0].name,
                  //     "image_url":path,
                  //     "subtitle": `Rank: ${response[0].rank}  \n\n Symbol : ${response[0].symbol}  \n Price: ${response[0].price} USD  \n Market Cap: ${response[0].market_cap} USD`
                  // };
                  // elements.push(element);
                  //sendGenericMessage(sender, elements);
                  if (response && response.length) {
                    sendTextMessage(sender, `*${response[0].name}* \n\`Rank : ${response[0].rank}\` \n\`Symbol : ${response[0].symbol}\` \n\`Price : ${response[0].price} USD\` \n\`Market Cap : ${response[0].market_cap} USD\``)
                  } else {
                    sendTextMessage(sender, "*Hey!* You can try something like : \n_\"current price of btc\"_ \n_\"convert 1 btc to inr\"_ \n_\"btc\"_ \n_\"market cap of btc\"_ \n_\"stock price of MSFT\"_\n*only cryptocurrency and company symbol supported e.g btc, eth, ibm, msft*");
                  }
                  })
                  .catch(err => console.log(err))
              } else if (entite && (entitePrice || entiteNum) && entitePrice != 'market cap') {
                // get price of cryptocurrency in respected currency
                let fiatcurrency = 'USD';
                if(fiatCurr) {
                  fiatcurrency = fiatCurr.toUpperCase();
                }

                makeRequest(entite.toUpperCase(), fiatcurrency)
                .then(function(response) {
                  if (response && response.length) {
                    let currencyPrice = response[0].price;
                    let num = entiteNum;
                    if(num) {
                      currencyPrice = entiteNum * currencyPrice;
                    } else {
                      num = '1';
                    }
                    sendTextMessage(sender, `Price of ${num} ${response[0].name} is *${currencyPrice}* ${fiatcurrency}.`)
                  } else {
                    sendTextMessage(sender, `Sorry, *${entite.toUpperCase()}* is not a vaild cryptocurrnecy symbol. Please give a vaild crypto symbol, e.g btc`)
                  }
                })
                .catch(err => console.log(err))
              } else if (entitePrice === 'market cap' && (entite || entiteCompany || fiatCurr)) {
                let nameOfCrypto = '';
                if (entite) {
                  nameOfCrypto = entite;
                } else if (fiatCurr) {
                  nameOfCrypto = fiatCurr;
                } else if (entiteCompany) {
                  nameOfCrypto = entiteCompany;
                }
                makeRequest(nameOfCrypto.toUpperCase(), 'USD')
                .then(function(response) {
                  if (response && response.length) {
                    sendTextMessage(sender, `Market Cap of ${response[0].name} is *${response[0].market_cap} USD*`);
                  } else {
                    sendTextMessage(sender, `Sorry, market cap for *${nameOfCrypto.toUpperCase()}* is not available. Only for crypto-currency it is available.`);
                  }
                })
                .catch(err => console.log(err))
              } else if (intent == 'stock-price' && entiteStock && (entiteCompany || entite || fiatCurr)) {
                let companyName = '';
                if (entiteCompany) {
                  companyName = entiteCompany;
                } else if (entite) {
                  companyName = entite;
                } else if (fiatCurr) {
                  companyName = fiatCurr;
                }
                makeRequestForStock(companyName.toUpperCase())
                .then(function(response) {
                  if(!isEmptyObject(response["Global Quote"])) {
                    sendTextMessage(sender, `Stock price of *${response["Global Quote"]["01. symbol"]}* is *${response["Global Quote"]["05. price"]} USD*`);
                  } else {
                    sendTextMessage(sender, `Sorry, currently stock price for *${companyName.toUpperCase()}* is not available.`);
                  }
                })
                .catch(err => console.log(err))
              } else {
                sendTextMessage(sender, `Sorry, currently this feature is not available.`);
              }
            })
            .catch((err) => {
              console.error('Oops! Got an error from Wit: ', err.stack || err);
            })
          }
        }  else if (event.postback) {
          console.log("inside postback");
          const sender = event.sender.id;
          handlePostback(sender, event.postback);
          console.log('received event', JSON.stringify(event));
        } else {
          console.log('received event', JSON.stringify(event));
        }
      });
    });
  }
  res.sendStatus(200);
});

function verifyRequestSignature(req, res, buf) {
  var signature = req.headers["x-hub-signature"];
  console.log(signature);

  if (!signature) {
    console.error("Couldn't validate the signature.");
  } else {
    var elements = signature.split('=');
    var method = elements[0];
    var signatureHash = elements[1];

    var expectedHash = crypto.createHmac('sha1', FB_APP_SECRET)
                        .update(buf)
                        .digest('hex');

    if (signatureHash != expectedHash) {
      throw new Error("Couldn't validate the request signature.");
    }
  }
}

const firstTraitValue = (traits, trait) => {
    const val = traits && traits[trait] &&
      Array.isArray(traits[trait]) &&
      traits[trait].length > 0 &&
      traits[trait][0].value &&
      traits[trait][0].confidence > 0.9
    ;
    if (!val) {
      return null;
    }
    return val;
  };

  const firstEntityValue = (entities, entity) => {
    const val = entities && entities[entity] &&
      Array.isArray(entities[entity]) &&
      entities[entity].length > 0 &&
      entities[entity][0].value;
    if (!val) {
      return null;
    }
    return typeof val === 'object' ? val.value : val;
  };

  const intentName = (intents) => {
    const val = intents &&
      Array.isArray(intents) &&
      intents.length > 0 &&
      intents[0].name;
    if (!val) {
      return null;
    }
    return typeof val === 'object' ? val.value : val;
  };

  async function makeRequest(id, currency) {

    const config = {
        method: 'get',
        url: 'https://api.nomics.com/v1/currencies/ticker',
        params: {
          key: NOMICS_API_KEY,
          ids: id,
          interval: '1h',
          convert: currency
        }
    }

   const result = await axios(config)
    .then(res => {
      console.log(res.status);
      console.log(res.data);
      return res.data;
    })
    .catch(err => {
      console.log(err);
    });
    return result;
}

async function makeRequestForStock(companyQuote) {

  const config = {
      method: 'get',
      url: 'https://www.alphavantage.co/query',
      params: {
        function: 'GLOBAL_QUOTE',
        symbol:companyQuote,
        apikey: STOCK_API_KEY
      }
  }

 const result = await axios(config)
  .then(res => {
    console.log(res.status);
    console.log(res.data);
    return res.data;
  })
  .catch(err => {
    console.log(err);
  });
  return result;
}

function sendTextMessage(recipientId, text) {
  var messageData = {
      recipient: {
          id: recipientId
      },
      message: {
          text: text
      }
  }
  fbMessage(messageData);
}

function isEmptyObject(obj) {
  return !Object.keys(obj).length;
}

// Handles messaging_postbacks events
function handlePostback(sender_psid, received_postback) {
    let msg = '';  
    let f_name = '';
    // Get the payload for the postback
    let payload = received_postback.payload;
  
    if (payload === 'WELCOME') {
      console.log("welcome");
      msg = "Hey " ;

      const config = {
        method: 'get',
        url: "https://graph.facebook.com/v2.6/" + sender_psid,
        params: {
          access_token: process.env.FB_PAGE_TOKEN,
          fields: "first_name"
        }
    }
  
   axios(config)
    .then(res => {
      console.log(res.status);
      console.log(res.data);
      msg = msg + res.data.first_name;
      sendTextMessage(sender_psid, msg);
    })
    .catch(err => {
      console.log(err);
    });
   }
  }

app.listen(PORT);
console.log('Listening on :' + PORT + '...');
