import { initializeApp, getApps } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  User,
} from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';

const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
export const auth = getAuth(app);

export const GOOGLE_FORMS_SCOPES = [
  'https://www.googleapis.com/auth/forms.body',
  'https://www.googleapis.com/auth/forms.responses.readonly',
];

const googleProvider = new GoogleAuthProvider();
for (const scope of GOOGLE_FORMS_SCOPES) {
  googleProvider.addScope(scope);
}
googleProvider.setCustomParameters({
  prompt: 'select_account',
});

// Strict in-memory caching for OAuth access token (never stored in localStorage/sessionStorage)
let isSigningIn = false;
let cachedGoogleAccessToken: string | null = null;

export function initFirebaseAuthListener(
  onUserSignedOut?: () => void
) {
  return onAuthStateChanged(auth, (user: User | null) => {
    if (!user && !isSigningIn) {
      cachedGoogleAccessToken = null;
      if (onUserSignedOut) onUserSignedOut();
    }
  });
}

export async function signInWithGoogleWorkspace(): Promise<{
  user: User;
  idToken: string;
  accessToken: string | null;
}> {
  isSigningIn = true;
  try {
    const result = await signInWithPopup(auth, googleProvider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    const accessToken = credential?.accessToken ?? null;
    if (accessToken) {
      cachedGoogleAccessToken = accessToken;
    }
    const idToken = await result.user.getIdToken();
    return { user: result.user, idToken, accessToken: cachedGoogleAccessToken };
  } finally {
    isSigningIn = false;
  }
}

export function getCachedGoogleAccessToken(): string | null {
  return cachedGoogleAccessToken;
}

export async function signOutGoogleWorkspace(): Promise<void> {
  cachedGoogleAccessToken = null;
  await auth.signOut();
}
