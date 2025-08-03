const express = require('express');
const admin = require('firebase-admin');
const cors = require('cors');
const dotenv = require('dotenv');

// .env फ़ाइल से environment variables लोड करें।
dotenv.config();

// Firebase Admin SDK को service account से इनिशियलाइज़ करें।
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();
const app = express();
// CORS Force Redeploy Comment - 2025-08-03 15:20:00

// CORS Middleware को कॉन्फ़िगर करें
const corsOptions = {
  origin: [
    'http://localhost:19006', // आपके वेब पर चल रहे Expo ऐप के लिए
    'http://localhost',       // कभी-कभी यह भी आवश्यक होता है
    // 'exp://your-expo-ip:port', // जब आप मोबाइल पर Expo Go में चलाएंगे तब के लिए। आपको अपने वास्तविक IP और पोर्ट को यहां जोड़ना पड़ सकता है
    'https://rupeezo-backend.vercel.app', // यदि आपका बैकएंड खुद से कोई रिक्वेस्ट करता है
    // भविष्य में आपके प्रोडक्शन फ्रंटएंड URL (जैसे 'https://rupeezoapp.com') को यहाँ जोड़ें
  ],
  methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
  credentials: true, // यदि आप क्रेडेंशियल (जैसे ऑथराइजेशन हेडर) भेज रहे हैं
  optionsSuccessStatus: 204
};
app.use(cors(corsOptions)); // <--- cors middleware को कॉन्फ़िगरेशन के साथ उपयोग करें

app.use(express.json()); // JSON बॉडी पार्स करने के लिए

// =================================================================================
// API Endpoints
// =================================================================================

// एक साधारण रूट यह जांचने के लिए कि सर्वर चल रहा है
app.get('/', (req, res) => {
  res.status(200).json({ message: 'Rupeezo Backend is running!' });
});

// ऑफ़रवॉल से क्रेडिट को संभालने के लिए Endpoint
// **ध्यान दें: userRef अब सीधे 'users' कलेक्शन को लक्षित करता है**
app.post('/api/credit-offerwall', async (req, res) => {
  const { userId, offerAmount } = req.body;

  if (!userId || !offerAmount) {
    return res.status(400).json({ error: 'User ID और ऑफ़र की राशि आवश्यक है।' });
  }

  // TODO: असली ऑफ़रवॉल से आए हुए डेटा को सत्यापित करने का कोड यहाँ जोड़ें।
  // उदाहरण के लिए, एक secret key या signature की जाँच करें।

  try {
    const userRef = db.collection('users').doc(userId); // <--- यहाँ बदलाव किया गया
    const userDoc = await userRef.get();

    let currentBalance = 0;
    if (userDoc.exists) {
      currentBalance = userDoc.data().balance || 0; // 'walletBalance' से 'balance' में बदल गया
    } else {
      // यदि Firestore में यूजर डॉक्यूमेंट नहीं है, तो Firebase Auth से ईमेल प्राप्त करने का प्रयास करें
      // यह सुनिश्चित करने के लिए कि नया डॉक्यूमेंट पूरी जानकारी के साथ बने
      let userEmail = 'unknown@example.com';
      try {
          const authUser = await admin.auth().getUser(userId);
          userEmail = authUser.email;
      } catch (authError) {
          console.warn(`Could not fetch email for userId ${userId}:`, authError.message);
      }
      // नया यूजर डॉक्यूमेंट बनाएं
      await userRef.set({ balance: 0, email: userEmail, createdAt: admin.firestore.FieldValue.serverTimestamp() });
    }

    // कमीशन लॉजिक (उदाहरण: 20% कमीशन)
    const commissionRate = 0.20; // 20% कमीशन
    const netAmountForUser = offerAmount * (1 - commissionRate);
    const yourCommission = offerAmount * commissionRate;

    const newBalance = currentBalance + netAmountForUser; // उपयोगकर्ता को नेट राशि क्रेडिट करें

    // वॉलेट बैलेंस अपडेट करें
    await userRef.set({ balance: newBalance }, { merge: true }); // 'walletBalance' से 'balance' में बदल गया

    // लेन-देन का रिकॉर्ड जोड़ें
    await userRef.collection('transactions').add({
      description: `ऑफ़र पूरा करने के लिए क्रेडिट (कमीशन के बाद)`,
      amount: netAmountForUser,
      date: admin.firestore.FieldValue.serverTimestamp(),
      type: 'credit',
      source: 'Offerwall'
    });

    // आपका कमीशन रिकॉर्ड करने के लिए (आप इसे अपने एडमिन डैशबोर्ड या अलग कलेक्शन में सहेज सकते हैं)
    console.log(`Your commission earned from userId ${userId}: ${yourCommission}`);
    // db.collection('commissions').add({ userId, amount: yourCommission, date: admin.firestore.FieldValue.serverTimestamp(), offerId: req.body.offerId });

    res.status(200).json({ message: 'वॉलेट में राशि सफलतापूर्वक जोड़ दी गई है।', newBalance, commission: yourCommission });
  } catch (error) {
    console.error('ऑफ़रवॉल क्रेडिट को संभालने में विफलता:', error);
    res.status(500).json({ error: 'एक आंतरिक सर्वर त्रुटि हुई।', details: error.message });
  }
});


// फ्रंटएंड के 'Earn Dummy Points' बटन के लिए नया एंडपॉइंट
// यह आपके फ्रंटएंड के '/earn' कॉल से मेल खाता है
app.post('/earn', async (req, res) => {
    const { userId, amount } = req.body; // फ्रंटएंड से userId और amount प्राप्त करें

    if (!userId || typeof amount === 'undefined' || amount <= 0) {
        return res.status(400).json({ message: 'अमान्य उपयोगकर्ता आईडी या राशि प्रदान की गई है।' });
    }

    try {
        const userRef = db.collection('users').doc(userId); // यह Firebase Auth UID से सीधे 'users' कलेक्शन को लक्षित करेगा
        const doc = await userRef.get();

        if (!doc.exists) {
            // यदि उपयोगकर्ता दस्तावेज़ मौजूद नहीं है, तो उसे Firebase Auth से ईमेल के साथ बनाएं
            let userEmail = 'unknown@example.com';
            try {
                const authUser = await admin.auth().getUser(userId);
                userEmail = authUser.email;
            } catch (authError) {
                console.warn(`Could not fetch email for userId ${userId}:`, authError.message);
            }
            await userRef.set({ balance: amount, email: userEmail, createdAt: admin.firestore.FieldValue.serverTimestamp() });
            return res.status(201).json({ message: `उपयोगकर्ता बनाया गया और ${amount} अंक जोड़े गए।`, newBalance: amount }); // newBalance जोड़ा गया
        } else {
            const currentBalance = doc.data().balance || 0; // सुनिश्चित करें कि 'balance' फ़ील्ड का उपयोग हो रहा है
            const newBalance = currentBalance + amount;
            await userRef.update({ balance: newBalance }); // 'balance' फ़ील्ड अपडेट करें

            // लेन-देन का रिकॉर्ड जोड़ें
            await userRef.collection('transactions').add({
                description: `डमी पॉइंट्स जोड़े गए`,
                amount: amount,
                date: admin.firestore.FieldValue.serverTimestamp(),
                type: 'credit',
                source: 'Dummy'
            });

            return res.status(200).json({ message: `${amount} अंक सफलतापूर्वक जोड़े गए! नया बैलेंस: ${newBalance}`, newBalance: newBalance }); // newBalance जोड़ा गया
        }
    } catch (error) {
        console.error('अंक जोड़ने में त्रुटि:', error);
        return res.status(500).json({ message: 'अंक जोड़ने में विफल।', error: error.message });
    }
});


// पैसे निकालने के लिए Endpoint
// **ध्यान दें: userRef अब सीधे 'users' कलेक्शन को लक्षित करता है**
app.post('/api/withdraw', async (req, res) => {
  const { userId, withdrawalAmount } = req.body;

  if (!userId || !withdrawalAmount) {
    return res.status(400).json({ error: 'User ID और निकासी की राशि आवश्यक है।' });
  }

  try {
    const userRef = db.collection('users').doc(userId); // <--- यहाँ बदलाव किया गया
    const userDoc = await userRef.get();

    if (!userDoc.exists || userDoc.data().balance < withdrawalAmount) { // 'walletBalance' से 'balance' में बदल गया
      return res.status(400).json({ error: 'आपके पास पर्याप्त शेष राशि नहीं है।' });
    }

    const currentBalance = userDoc.data().balance; // 'walletBalance' से 'balance' में बदल गया
    const newBalance = currentBalance - withdrawalAmount;

    // TODO: असली पेमेंट गेटवे के साथ इंटीग्रेशन का कोड यहाँ जोड़ें।

    // वॉलेट बैलेंस अपडेट करें
    await userRef.set({ balance: newBalance }, { merge: true }); // 'walletBalance' से 'balance' में बदल गया

    // लेन-देन का रिकॉर्ड जोड़ें
    await userRef.collection('transactions').add({
      description: `भुगतान निकालें`,
      amount: -withdrawalAmount, // निकासी के लिए नकारात्मक राशि
      date: admin.firestore.FieldValue.serverTimestamp(),
      type: 'withdrawal'
    });

    res.status(200).json({ message: 'निकासी सफलतापूर्वक हो गई है।', newBalance });
  } catch (error) {
    console.error('निकासी को संभालने में विफलता:', error);
    res.status(500).json({ error: 'एक आंतरिक सर्वर त्रुटि हुई।' });
  }
});

// सर्वर शुरू करें
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`सर्वर पोर्ट ${PORT} पर चल रहा है।`);
});