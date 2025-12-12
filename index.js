require('dotenv').config()
const express = require('express')
const cors = require('cors')
const admin = require("firebase-admin");
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const Stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const decoded = Buffer.from(process.env.FB_SERVICE_KEY, 'base64').toString('utf-8');
const serviceAccount = JSON.parse(decoded);
const port = 3000
const app = express();
app.use(cors({
  origin: [process.env.CLIENT_DOMAIN],
  credentials: true
}));
app.use(express.json());

// Decode service account key


// Initialize Firebase Admin
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

// JWT Middleware
const verifyJWT = async (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).send({ message: "Unauthorized" });

  try {
    const decoded = await admin.auth().verifyIdToken(token);
    req.tokenEmail = decoded.email;
    next();
  } catch (err) {
    console.error("JWT verification error:", err);
    return res.status(401).send({ message: "Unauthorized", err });
  }
};


const client = new MongoClient(process.env.MONGODB_URI, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {
  try {
    await client.connect();

    const db = client.db('tuition-db')
    const usersCollection = db.collection('users')
    const tuitionCollection = db.collection('tuition')
    const tutorCollection = db.collection('tutor')
    const paymentCollection = db.collection('payment')

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

    app.post('/create-checkout-session', async (req, res) => {
      try {
        const paymentInfo = req.body;
        const session = await Stripe.checkout.sessions.create({
          payment_method_types: ['card'],
          mode: 'payment',
          line_items: [
            {
              price_data: {
                currency: 'usd',
                product_data: { name: paymentInfo.name },
                unit_amount: paymentInfo.price * 100,
              },
              quantity: 1,
            },
          ],
          customer_email: paymentInfo.student.email,
          metadata: {
            tutorId: paymentInfo.tutorId,
            studentEmail: paymentInfo.student.email,
          },
          success_url: `${process.env.CLIENT_DOMAIN}/dashboard/payment-success?session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${process.env.CLIENT_DOMAIN}/student/${paymentInfo?.tutorId}`,
        });

        res.send({ url: session.url });
      } catch (error) {
        console.log("Stripe session error:", error);
        res.status(500).send({ message: "Checkout session failed", error });
      }
    });

    app.get('/tuitions/tutor/approved/:tutorId', async (req, res) => {
      const { tutorId } = req.params;
      const tuitions = await tuitionCollection
        .find({ tutorId: new ObjectId(tutorId), status: 'Approved' })
        .toArray();
      res.send(tuitions);
    });


    // Get all approved tuitions for a specific tutor

    app.post('/payment-success', async (req, res) => {
      try {
        const { sessionId } = req.body;
        const session = await Stripe.checkout.sessions.retrieve(sessionId);
        const tutorId = session.metadata.tutorId;
        const studentEmail = session.metadata.studentEmail;

        // Check duplicate payment
        const existingPayment = await paymentCollection.findOne({
          transactionId: session.payment_intent
        });

        if (!existingPayment) {
          const paymentData = {
            tutorId: new ObjectId(tutorId), // ObjectId হিসেবে save
            studentEmail,
            transactionId: session.payment_intent,
            amount: session.amount_total / 100,
            status: "Success",
            date: new Date()
          };
          await paymentCollection.insertOne(paymentData);
        }

        // Update tutor status
        await tutorCollection.updateOne(
          { _id: new ObjectId(tutorId) },
          { $set: { status: "Approved" } }
        );

        // Update tuition document
        await tuitionCollection.updateOne(
          { "student.email": studentEmail, status: "Pending" },
          { $set: { status: "Approved", tutorId: new ObjectId(tutorId) } }
        );

        res.send({ success: true });
      } catch (error) {
        console.error("Payment success error:", error);
        res.status(500).send({ message: "Payment success processing failed", error });
      }
    });
    // Delete a tuition by ID
    app.delete('/tuition/:id', async (req, res) => {
      const id = req.params.id;
      const result = await tuitionCollection.deleteOne({ _id: new ObjectId(id) });
      res.send(result)
    });

    app.get('/payment', async (req, res) => {
      const payments = await paymentCollection.find().toArray();
      res.send(payments);
    });

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
      const result = await tutorCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { status } })
      const update = await tutorCollection.findOne({ _id: new ObjectId(id) })
      res.send(update)
    })
    app.delete('/tutor/:id', async (req, res) => {
      const id = req.params.id;
      const result = await tutorCollection.deleteOne({ _id: new ObjectId(id) });
      res.send(result)
    });

    app.get('/tutor/:id', async (req, res) => {
      const id = req.params.id;
      const tutor = await tutorCollection.findOne({ _id: new ObjectId(id) });
      res.send(tutor);
    });


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

    app.get('/user/role', verifyJWT, async (req, res) => {
      const result = await usersCollection.findOne({ email: req.tokenEmail })
      res.send({ role: result?.role })
    })

    app.get('/users', async (req, res) => {
      const adminEmail = req.tokenEmail
      const result = await usersCollection.find({ email: { $ne: adminEmail } }).toArray()
      res.send(result)
    })

    // Update a user
    app.patch('/user/:id', verifyJWT, verifyADMIN, async (req, res) => {
        const id = req.params.id;
        const { _id, ...updatedData } = req.body; // remove _id
        const result = await usersCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: updatedData }
        );
        const updatedUser = await usersCollection.findOne({ _id: new ObjectId(id) });
        res.send(updatedUser);
     res.status(500).send({ message: "Server error", error: err.message });
      
    });


    // Delete a user
    app.delete('/user/:id', verifyJWT, verifyADMIN, async (req, res) => {
      const id = req.params.id;
      const result = await usersCollection.deleteOne({ _id: new ObjectId(id) });
      res.send(result);
    });





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
