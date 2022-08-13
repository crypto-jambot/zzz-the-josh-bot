/*********************************************************************
 * Copyright (C) 2022 Joshua Sells joshuataylorsells@gmail.com
 *
 * Unauthorized copying of this file, via any medium is strictly prohibited
 *
 * Proprietary and confidential
 *
 *********************************************************************/

import 'dotenv/config';
import express from 'express';
import { main } from './index';

const app = express();
app.use(express.json()); // for parsing application/json
app.use(express.urlencoded({ extended: true })); // for parsing application/x-www-form-urlencoded

app.post('/', (req, res) => {
    const pair = req.body;
    main(pair).then((result) => {
        if (result == null) {
            res.status(200).send();
        } else {
            res.json(result);
        }
    });
});

const PORT = process.env.PORT || 8000;

app.listen(PORT, () => {
    console.log(`the-josh-bot: listening on port ${PORT}`);
});
