'use strict';

const fetch = require('node-fetch');
const { MongoClient } = require('mongodb');
const crypto = require('crypto');

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017';
const DB_NAME = 'stockchecker';
const COLLECTION = 'stocks';

let db;
MongoClient.connect(MONGO_URI, { useUnifiedTopology: true })
  .then(client => {
    db = client.db(DB_NAME);
    console.log('Connected to MongoDB');
  })
  .catch(err => console.error('MongoDB connection error:', err));

function hashIP(ip) {
  return crypto.createHash('sha256').update(ip).digest('hex');
}

async function getStockData(stock) {
  const url = `https://stock-price-checker-proxy.freecodecamp.rocks/v1/stock/${stock}/quote`;
  const response = await fetch(url);
  if (!response.ok) throw new Error('Stock not found');
  const data = await response.json();
  return {
    stock: data.symbol,
    price: data.latestPrice
  };
}

async function updateLikes(stock, hashedIp, like) {
  const collection = db.collection(COLLECTION);
  let update = {};
  if (like) {
    update = {
      $addToSet: { ips: hashedIp }
    };
  }
  await collection.updateOne(
    { stock },
    { $setOnInsert: { stock, ips: [] }, ...update },
    { upsert: true }
  );
  const doc = await collection.findOne({ stock });
  return doc.ips.length;
}

async function getLikes(stock) {
  const collection = db.collection(COLLECTION);
  const doc = await collection.findOne({ stock });
  return doc ? doc.ips.length : 0;
}

module.exports = function (app) {
  app.route('/api/stock-prices')
    .get(async function (req, res) {
      try {
        let { stock, like } = req.query;
        like = like === 'true' || like === 'on';
        const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
        const hashedIp = hashIP(ip);

        if (!stock) return res.status(400).json({ error: 'Stock is required' });

        if (Array.isArray(stock)) {
          // Два тикера
          const [stock1, stock2] = stock.map(s => s.toUpperCase());
          const [data1, data2] = await Promise.all([
            getStockData(stock1),
            getStockData(stock2)
          ]);
          const [likes1, likes2] = await Promise.all([
            like ? updateLikes(stock1, hashedIp, true) : getLikes(stock1),
            like ? updateLikes(stock2, hashedIp, true) : getLikes(stock2)
          ]);
          res.json({
            stockData: [
              {
                stock: data1.stock,
                price: data1.price,
                rel_likes: likes1 - likes2
              },
              {
                stock: data2.stock,
                price: data2.price,
                rel_likes: likes2 - likes1
              }
            ]
          });
        } else {
          // Один тикер
          stock = stock.toUpperCase();
          const data = await getStockData(stock);
          const likes = like ? await updateLikes(stock, hashedIp, true) : await getLikes(stock);
          res.json({
            stockData: {
              stock: data.stock,
              price: data.price,
              likes
            }
          });
        }
      } catch (err) {
        res.status(500).json({ error: 'Invalid stock or server error' });
      }
    });
};