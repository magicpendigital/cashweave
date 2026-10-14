import { createNextApp } from './app.js';
import { showStorageFailure } from './storage-failure.js';
const root=document.getElementById('next-app');
createNextApp(root).catch(()=>showStorageFailure(root));
