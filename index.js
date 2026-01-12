require('dotenv').config()
const express = require('express')
const cors = require('cors')
const admin = require("firebase-admin");
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const decoded = Buffer.from(process.env.FB_SERVICE_KEY, 'base64').toString('utf-8');
const serviceAccount = JSON.parse(decoded);
const port = process.env.PORT || 3000
const app = express();
app.use(
  cors({
    origin: ["http://localhost:5173", process.env.CLIENT_DOMAIN],
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
    allowedHeaders: ["Content-Type", 'Authorization'],
    credentials: true,
  })
);
app.use(express.json());

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

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
    // await client.connect();

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

    // app.post('/tuition', async (req, res) => {
    //   const tuitionData = req.body
    //   const result = await tuitionCollection.insertOne(tuitionData)
    //   res.send(result)
    // })
    app.post('/tuition', async (req, res) => {
      const tuitionData = req.body;
      if (!tuitionData.createdAt) {
        tuitionData.createdAt = new Date().toISOString();
      }

      const result = await tuitionCollection.insertOne(tuitionData);
      res.send(result);
    });
    app.get('/tuition', async (req, res) => {

      const result = await tuitionCollection.find().toArray()
      res.send(result)
    })

    app.patch('/tuition/:id', async (req, res) => {
      try {
        const id = req.params.id;
        const { status } = req.body; // only take status from frontend

        if (!['Pending', 'Approved', 'Rejected'].includes(status)) {
          return res.status(400).send({ message: 'Invalid status value' });
        }

        // Update only the status
        const result = await tuitionCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { status } }
        );

        if (result.matchedCount === 0) {
          return res.status(404).send({ message: 'Tuition not found' });
        }

        const updatedTuition = await tuitionCollection.findOne({ _id: new ObjectId(id) });
        res.send(updatedTuition);
      } catch (error) {
        console.error('Error updating tuition status:', error);
        res.status(500).send({ message: 'Server error', error });
      }
    });



    app.post('/create-checkout-session', async (req, res) => {
      try {
        const paymentInfo = req.body;
        const session = await stripe.checkout.sessions.create({
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
            studentName: paymentInfo.student.name
            // d,
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


    app.post('/payment-success', async (req, res) => {
      const { sessionId } = req.body;
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      const tutorId = session.metadata.tutorId;
      console.log(session)
      console.log(tutorId)
      console.log(sessionId)

      const existingPayment = await paymentCollection.findOne({
        transactionId: session.payment_intent
      });

      if (!existingPayment) {
        const paymentData = {
          tutorId: new ObjectId(tutorId),
          studentEmail: session.customer_email,
          studentName: session.metadata.studentName,
          transactionId: session.payment_intent,
          amount: session.amount_total / 100,
          status: "Success",
          date: new Date()
        };
        await paymentCollection.insertOne(paymentData);
      }

      await tutorCollection.updateOne(
        { _id: new ObjectId(tutorId) },
        { $set: { status: "Approved" } }
      );

      await tuitionCollection.updateOne(
        { status: "Pending" },
        { $set: { status: "Approved", tutorId: new ObjectId(tutorId) } }
      );

      res.send({ success: true });

    });



    app.delete('/tuition/:id', async (req, res) => {
      const id = req.params.id;
      const result = await tuitionCollection.deleteOne({ _id: new ObjectId(id) });
      res.send(result)
    });

    app.get('/payment', async (req, res) => {
      const payments = await paymentCollection
        .find()
        .sort({ date: -1 })
        .toArray();

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
      const id = req.params.id;

      const tutor = await tutorCollection.findOne({ _id: new ObjectId(id) });
      if (tutor.status === 'Approved') {
        return res.status(400).send({ message: 'Approved tutor cannot be edited' });
      }

      const result = await tutorCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: req.body }
      );

      res.send(result);
    });

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


      userData.role = userData.role || 'student'

      const query = { email: userData.email }
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
    app.get('/users', verifyJWT, async (req, res) => {
      const adminEmail = req.tokenEmail
      const result = await usersCollection
        .find({ email: { $ne: adminEmail } })
        .toArray()
      res.send(result)
    })


    app.patch('/user/:id', verifyJWT, verifyADMIN, async (req, res) => {
      const id = req.params.id;
      const { _id, ...updatedData } = req.body; // remove _id
      const result = await usersCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: updatedData }
      );
      const updatedUser = await usersCollection.findOne({ _id: new ObjectId(id) });
      res.send(updatedUser);
    });



    app.delete('/user/:id', verifyJWT, verifyADMIN, async (req, res) => {
      const id = req.params.id;
      const result = await usersCollection.deleteOne({ _id: new ObjectId(id) });
      res.send(result);
    });


 
app.get('/Overview', verifyJWT, async (req, res) => {
  try {
    const email = req.tokenEmail;
    const user = await usersCollection.findOne({ email });
    
    
    const totalUsers = await usersCollection.estimatedDocumentCount();
    const totalTuition = await tuitionCollection.estimatedDocumentCount();
    const totalTutors = await tutorCollection.estimatedDocumentCount();
    
   
    const allPayments = await paymentCollection.find().toArray() || [];
    const paymentCount = allPayments.length; 
    const revenue = allPayments.reduce((sum, p) => sum + (parseFloat(p.amount) || 0), 0);

  
    const chartData = allPayments.map(p => ({
      date: p.date ? new Date(p.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : 'N/A',
      amount: parseFloat(p.amount) || 0
    })).slice(-7);

    res.send({ 
      users: totalUsers, 
      tuition: totalTuition, 
      tutors: totalTutors,
      payments: paymentCount, 
      revenue: user.role === 'admin' ? revenue : 'Restricted', 
      chartData,
      userRole: user?.role || 'student'
    });
  } catch (error) {
    console.error("Stats Error:", error);
    res.status(500).send({ message: "Error", error: error.message });
  }
});

    // await client.db("admin").command({ ping: 1 });
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
