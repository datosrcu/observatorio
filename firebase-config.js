import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { getFirestore, collection, getDocs, doc, getDoc, addDoc, serverTimestamp, updateDoc, deleteDoc, setDoc, query, where, orderBy, limit } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { getStorage, ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-storage.js";

const isCustomDomain = window.location.hostname !== "localhost" && window.location.hostname !== "127.0.0.1";
const authDomain = isCustomDomain ? window.location.hostname : "web-subse.firebaseapp.com";

const firebaseConfig = {
  apiKey: "AIzaSyAidGT2L17aLE529cWjisko24FZT8_kkBA",
  authDomain: authDomain,
  projectId: "web-subse",
  storageBucket: "web-subse.firebasestorage.app",
  messagingSenderId: "1054370535841",
  appId: "1:1054370535841:web:feb9959fda7bc8f70293e0",
  measurementId: "G-4G4KQS525S"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);
const provider = new GoogleAuthProvider();

export { 
    app, auth, db, storage, provider, 
    signInWithPopup, signInWithRedirect, signOut, onAuthStateChanged, 
    collection, getDocs, doc, getDoc, addDoc, serverTimestamp, updateDoc, deleteDoc, setDoc, query, where, orderBy, limit,
    ref, uploadBytes, getDownloadURL 
};
