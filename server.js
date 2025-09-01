require("dotenv").config();

const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const multer = require("multer"); // สำหรับจัดการการอัปโหลดไฟล์ชั่วคราว
const cloudinary = require("cloudinary").v2; // สำหรับอัปโหลดรูปภาพไป Cloudinary

const app = express();
const PORT = process.env.PORT || 8000;

// Middleware
app.use(cors({ origin: "http://localhost:5173" }));
app.use(express.json()); // อนุญาตให้ Express อ่าน JSON body ใน Request ได้

//  ตั้งค่า Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

//  ตั้งค่า Multer สำหรับการอัปโหลดไฟล์ชั่วคราว
// เราจะเก็บไฟล์ที่อัปโหลดไว้ในหน่วยความจำชั่วคราว เพื่อส่งต่อไปยัง Cloudinary
const storage = multer.memoryStorage(); // ใช้ memoryStorage เพื่อเก็บไฟล์ใน RAM
const upload = multer({ storage: storage });

// ---------------- MongoDB Connection ----------------
const MONGODB_URI = process.env.MONGODB_URI;

mongoose
  .connect(MONGODB_URI)
  .then(() => console.log("MongoDB connected successfully!"))
  .catch((err) => {
    console.error("MongoDB connection error:", err);
    process.exit(1); // ออกจาก process หากเชื่อมต่อไม่ได้
  });

// ---------------- MongoDB Schema & Model ----------------
// กำหนด Schema สำหรับ E-book
const ebookSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
  },
  bookLink: {
    type: String,
    required: true,
  },
  imageUrl: {
    type: String,
    default: "https://placehold.co/300x200/cccccc/333333?text=No+Image", // รูปภาพ fallback
  },
  public_id: {
    // เก็บ public_id ของ Cloudinary เพื่อใช้ลบหรืออัปเดต
    type: String,
  },
});

// สร้าง Model จาก Schema
const Ebook = mongoose.model("Ebook", ebookSchema);

// ---------------- API Routes ----------------
// GET: ดึงE-bookทั้งหมด
app.get("/api/ebooks", async (req, res) => {
  try {
    const ebooks = await Ebook.find(); // ดึง E-book ทั้งหมดจากฐานข้อมูล
    res.json(ebooks); // ส่ง E-book กลับไปในรูปแบบ JSON
  } catch (err) {
    console.error("Error fetching ebooks:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
});

// POST: เพิ่ม E-book
// `upload.single('ebookImage')` หมายถึงจะรับไฟล์เดียวที่ชื่อ field เป็น 'ebookImage'
app.post("/api/ebooks", upload.single("ebookImage"), async (req, res) => {
  const { title, bookLink } = req.body;
  let imageUrl = "https://placehold.co/300x200/cccccc/333333?text=No+Image";
  let public_id = null;

  // ตรวจสอบข้อมูลที่จำเป็น
  if (!title || !bookLink) {
    return res
      .status(400)
      .json({ message: "Please provide title and bookLink" });
  }

  try {
    // 1. อัปโหลดรูปภาพไป Cloudinary (ถ้ามีไฟล์ถูกส่งมา)
    if (req.file) {
      // แปลง buffer เป็น data URI
      const dataUri = `data:${
        req.file.mimetype
      };base64,${req.file.buffer.toString("base64")}`;
      const uploadResult = await cloudinary.uploader.upload(dataUri, {
        folder: "ebook_covers", // โฟลเดอร์ใน Cloudinary
      });
      imageUrl = uploadResult.secure_url;
      public_id = uploadResult.public_id;
    }
    // 2. สร้างและบันทึก E-book ลง MongoDB
    const newEbook = new Ebook({
      title,
      bookLink,
      imageUrl,
      public_id,
    });
    const savedEbook = await newEbook.save(); // บันทึก E-book ใหม่ลงฐานข้อมูล

    res.status(201).json(savedEbook); // ส่ง E-book ที่บันทึกแล้วกลับไป
  } catch (err) {
    console.error("Error adding ebook:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
});

// PUT: Edit ebook
app.put("/api/ebooks/:id", upload.single("ebookImage"), async (req, res) => {
  const { title, bookLink } = req.body;

  try {
    const ebook = await Ebook.findById(req.params.id);
    if (!ebook) {
      return res.status(404).json({ message: "E-book not found" });
    }

    // Update fields
    ebook.title = title || ebook.title;
    ebook.bookLink = bookLink || ebook.bookLink;

    // New image upload
    if (req.file) {
      if (ebook.public_id) {
        await cloudinary.uploader.destroy(ebook.public_id);
      }

      const dataUri = `data:${
        req.file.mimetype
      };base64,${req.file.buffer.toString("base64")}`;
      const uploadResult = await cloudinary.uploader.upload(dataUri, {
        folder: "ebook_covers",
      });
      ebook.imageUrl = uploadResult.secure_url;
      ebook.public_id = uploadResult.public_id;
    }

    const updatedEbook = await ebook.save();
    res.json(updatedEbook);
  } catch (err) {
    console.error("Error updating ebook:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
});

// DELETE: Delete ebook
app.delete("/api/ebooks/:id", async (req, res) => {
  try {
    const ebook = await Ebook.findByIdAndDelete(req.params.id);
    if (!ebook) {// ถ้าไม่เจอe-book จะแสดงข้อความ
      return res.status(404).json({ message: "E-book not found" });
    }

    if (ebook.public_id) {// ถ้ามีรูปจะลบรูป
      await cloudinary.uploader.destroy(ebook.public_id);
    }
    res.json({ message: "Ebook and its image deleted successfully" });
  } catch (err) {
    console.error("Error deleting ebook:", err);
    res.status(500).json({ message: "Server error", error: err.message });
  }
});

// ---------------- Start Server ----------------
app.listen(PORT, () => {
  console.log(`Backend server running on port ${PORT}`);
  console.log(`Access E-books API at: http://localhost:${PORT}/api/ebooks`);
});
