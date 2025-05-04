import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import ImageKit from "imagekit";
import mongoose from "mongoose";
import Chat from "./models/chat.js";
import UserChats from "./models/userChats.js";
import { clerkMiddleware, getAuth, requireAuth } from "@clerk/express";
import dotenv from "dotenv";

dotenv.config();
const port = process.env.PORT || 3000;
const app = express();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(
  cors({
    origin: process.env.CLIENT_URL,
    credentials: true,
  })
);

app.use(express.json());
// app.use(clerkMiddleware); // ✅ Clerk middleware added early

// DB connection
const connect = async () => {
  try {
    await mongoose.connect(process.env.MONGO);
    console.log("Connected to MongoDB");
  } catch (err) {
    console.log(err);
  }
};

// ImageKit setup
const imagekit = new ImageKit({
  urlEndpoint: process.env.IMAGE_KIT_ENDPOINT,
  publicKey: process.env.IMAGE_KIT_PUBLIC_KEY,
  privateKey: process.env.IMAGE_KIT_PRIVATE_KEY,
});

// Image upload signature
app.get("/api/upload", (req, res) => {
  const result = imagekit.getAuthenticationParameters();
  res.send(result);
});

// // Create new chat
app.post("/api/chats", requireAuth(), async (req, res) => {
  const { userId } = getAuth(req);
  const { text } = req.body;

  try {
    const newChat = new Chat({
      userId,
      history: [{ role: "user", parts: [{ text }] }],
    });

    const savedChat = await newChat.save();

    const userChats = await UserChats.find({ userId });

    if (!userChats.length) {
      const newUserChats = new UserChats({
        userId,
        chats: [
          {
            _id: savedChat._id,
            title: text.substring(0, 40),
          },
        ],
      });

      await newUserChats.save();
    } else {
      await UserChats.updateOne(
        { userId },
        {
          $push: {
            chats: {
              _id: savedChat._id,
              title: text.substring(0, 40),
            },
          },
        }
      );
    }

    res.status(201).send(savedChat._id);
  } catch (err) {
    console.log(err);
    res.status(500).send("Error creating chat!");
  }
});

// Get user chats
app.get("/api/userchats", requireAuth({
  unauthorized: (req, res) => res.status(401).json({ message: "Unauthorized" })
}), async (req, res) => {
  const { userId } = getAuth(req);

  try {
    const userChats = await UserChats.find({ userId });
    res.status(200).send(userChats?.[0]?.chats || []);
  } catch (err) {
    console.log(err);
    res.status(500).send("Error fetching userchats!");
  }
});

// Get specific chat
app.get("/api/chats/:id", requireAuth(), async (req, res) => {
  const { userId } = getAuth(req);

  try {
    const chat = await Chat.findOne({ _id: req.params.id, userId });
    res.status(200).send(chat);
  } catch (err) {
    console.log(err);
    res.status(500).send("Error fetching chat!");
  }
});

// Update chat history
app.put("/api/chats/:id", requireAuth({
  unauthorized: (req, res) => res.status(401).json({ message: "Unauthorized" })
}), async (req, res) => {
  const { userId } = getAuth(req);
  const { question, answer, img } = req.body;

  const newItems = [
    ...(question
      ? [{ role: "user", parts: [{ text: question }], ...(img && { img }) }]
      : []),
    { role: "model", parts: [{ text: answer }] },
  ];

  try {
    const updatedChat = await Chat.updateOne(
      { _id: req.params.id, userId },
      { $push: { history: { $each: newItems } } }
    );
    res.status(200).send(updatedChat);
  } catch (err) {
    console.log(err);
    res.status(500).send("Error adding conversation!");
  }
});

// Catch auth errors
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(401).send("Unauthenticated!");
});

// Serve static files in production
app.use(express.static(path.join(__dirname, "../client/dist")));

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "../client/dist", "index.html"));
});

app.get("/api/health", (req, res) => {
  res.status(200).send("Server is healthy ✅");
});


app.listen(port, () => {
  connect();
  console.log("Server running on", port);
});
