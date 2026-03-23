import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import { GoogleOAuthProvider } from '@react-oauth/google'

// In your main.jsx / index.js
const GOOGLE_CLIENT_ID = "497469882626-2me5o1vnjciidug6bl63rep6dsiaa7i7.apps.googleusercontent.com"; 

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>
      <App />
    </GoogleOAuthProvider>
  </React.StrictMode>,
)