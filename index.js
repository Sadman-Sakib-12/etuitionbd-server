require('dotenv').config()
const express = require('express')
const cors = require('cors')
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const app = express()
const port = 3000

app.use(
  cors({
    origin: 'http://localhost:5173',
    credentials: true,
    optionsSuccessStatus: 200
  })
)
app.use(express.json())

const client = new MongoClient(process.env.MONGODB_URI, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {
  try {
    await client.connect()

    const db = client.db('tuition-db')
    const usersCollection = db.collection('users')
    const tuitionCollection = db.collection('tuition')
    const tutorCollection = db.collection('tutor')

    const verifyADMIN = async (req, res, next) => {
      const email = req.tokenEmail
      const user = await usersCollection.findOne({ email })
      if (user?.role !== 'admin')
        return res
          .status(403)
          .send({ message: 'Admin only Actions!', role: user?.role })
      next()
    }

    app.post('/tuition', async (req, res) => {
      const tuitionData = req.body
      const result = await tuitionCollection.insertOne(tuitionData)
      res.send(result)
    })
    app.get('/tuition', async (req, res) => {

      const result = await tuitionCollection.find().toArray()
      res.send(result)
    })

    app.patch('/tuition/:id', async (req, res) => {
      const id = req.params.id
      const { status } = req.body
      const result = await tuitionCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { status } })
      const update = await tuitionCollection.findOne({ _id: new ObjectId(id) })
      res.send(update)
    })

    app.post('/tutor', async (req, res) => {
      const tutorData = req.body
      const result = await tutorCollection.insertOne(tutorData)
      res.send(result)
    })
    app.get('/tutor', async (req, res) => {
      const result = await tutorCollection.find().toArray()
      res.send(result)
    })
    app.patch('/tutor/:id', async (req, res) => {
      const id = req.params.id
      const { status } = req.body
      const result = await tuitionCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { status } })
      const update = await tutorCollection.findOne({ _id: new ObjectId(id) })
      res.send(update)
    })

    app.post('/user', async (req, res) => {
      const userData = req.body
      userData.created_at = new Date().toISOString()
      userData.last_loggedIn = new Date().toISOString()
      userData.role = 'student'
      const query = {
        email: userData.email,
      }
      const alreadyExists = await usersCollection.findOne(query)
      if (alreadyExists) {
        const result = await usersCollection.updateOne(query, {
          $set: {
            last_loggedIn: new Date().toISOString(),
          }
        })
        return res.send(result)
      }
      const result = await usersCollection.insertOne(userData)
      res.send(result)
    })

    app.get('/user/role', async (req, res) => {
      const result = await usersCollection.findOne({ email: req.tokenEmail })
      res.send({ role: result?.role })
    })

    // app.get('/users', async (req, res) => {
    //   const adminEmail = req.tokenEmail
    //   const result = await usersCollection.find({ email: { $ne: adminEmail } }).toArray()
    //   res.send(result)
    // })





    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // Ensures that the client will close when you finish/error
  }
}
run().catch(console.dir);

app.get('/', (req, res) => {
  res.send('Sakib Al Hasan!')
})

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`)
})
