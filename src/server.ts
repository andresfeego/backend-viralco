import 'dotenv/config';
import express from 'express';
import cors from 'cors';

import signedUrlRoute from './routes/signed-url.ts';
import postRoute from './routes/post.ts';

const app = express();
app.use(cors());
app.use(express.json());

app.use('/api/signed-url', signedUrlRoute);
app.use('/api/posts', postRoute);

app.listen(process.env.PORT, () => {
  console.log(`Server is running on port ${process.env.PORT}`);
});
