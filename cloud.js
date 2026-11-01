// Hfad – cloud sync with Firebase (Google sign-in + Firestore).
// Each user has one document users/{uid} that only they can read and write (see Firestore security rules).
// This config is public by design: what protects the data is the security rules, not this key.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, onAuthStateChanged, signOut, deleteUser, reauthenticateWithPopup } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyBqS0KOD5JH1_HmDBtMdSlO0NcBo10iruY",
  authDomain: "hfad-30a1c.firebaseapp.com",
  projectId: "hfad-30a1c",
  storageBucket: "hfad-30a1c.firebasestorage.app",
  messagingSenderId: "92446458568",
  appId: "1:92446458568:web:bf957932e87f323fc31bfd",
};

const fb = initializeApp(firebaseConfig);
const auth = getAuth(fb);
const db = getFirestore(fb);
const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: "select_account" });

const ref = () => doc(db, "users", auth.currentUser.uid);
window.cloud = {
  ready: true,
  user: null,
  async signIn() {
    try { await signInWithPopup(auth, provider); }
    catch (e) {
      // Some browsers (home-screen apps, strict pop-up blockers) refuse pop-ups: fall back to a full-page redirect.
      if (["auth/popup-blocked", "auth/operation-not-supported-in-this-environment", "auth/cancelled-popup-request"].includes(e.code)) return signInWithRedirect(auth, provider);
      if (e.code !== "auth/popup-closed-by-user") throw e;
    }
  },
  signOut: () => signOut(auth),
  async pull() { const s = await getDoc(ref()); return s.exists() ? s.data() : null; },
  push: data => setDoc(ref(), data),
  // Deletes the saved data, then the account itself. Google asks for a recent sign-in before deleting an account.
  async deleteAccount() {
    try { await deleteDoc(ref()); } catch (e) { e.nothingDeleted = true; throw e; }
    const user = auth.currentUser;
    try { await deleteUser(user); }
    catch (e) {
      if (e.code !== "auth/requires-recent-login") throw e;
      await reauthenticateWithPopup(user, provider);
      await deleteUser(user);
    }
  },
};
getRedirectResult(auth).catch(() => {});
onAuthStateChanged(auth, user => {
  window.cloud.user = user;
  window.dispatchEvent(new CustomEvent("cloud-auth"));
});
window.dispatchEvent(new CustomEvent("cloud-ready"));
