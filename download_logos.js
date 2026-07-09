const fs = require('fs');
const https = require('https');
const path = require('path');

const logos = {
    'ring': 'https://upload.wikimedia.org/wikipedia/commons/2/23/Ring_logo.svg',
    'wyze': 'https://upload.wikimedia.org/wikipedia/commons/9/91/Wyze_logo.svg',
    'tuya': 'https://upload.wikimedia.org/wikipedia/commons/4/4b/Tuya_logo.svg',
    'nest': 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/c5/Google_Nest_logo.svg/512px-Google_Nest_logo.svg.png',
    'arlo': 'https://upload.wikimedia.org/wikipedia/commons/5/5e/Arlo_logo.svg',
    'hikvision': 'https://upload.wikimedia.org/wikipedia/commons/thumb/1/1d/Hikvision_logo.svg/512px-Hikvision_logo.svg.png',
    'dahua': 'https://upload.wikimedia.org/wikipedia/commons/thumb/4/4c/Dahua_Technology_logo.svg/512px-Dahua_Technology_logo.svg.png',
    'ezviz': 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/87/Ezviz_logo.svg/512px-Ezviz_logo.svg.png',
    'tapo': 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/05/TP-Link_logo.svg/512px-TP-Link_logo.svg.png',
    'reolink': 'https://raw.githubusercontent.com/home-assistant/brands/master/custom_components/reolink_dev/icon%402x.png'
};

const dir = path.join(__dirname, 'frontend/public/assets/logos');
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

Object.entries(logos).forEach(([name, url]) => {
    const ext = url.endsWith('.png') ? '.png' : '.svg';
    const filepath = path.join(dir, `${name}${ext}`);
    const options = {
        headers: { 'User-Agent': 'Mozilla/5.0 (Scryvex)' }
    };
    https.get(url, options, (res) => {
        if (res.statusCode === 200) {
            const file = fs.createWriteStream(filepath);
            res.pipe(file);
            console.log(`Downloaded ${name}${ext}`);
        } else {
            console.log(`Failed ${name}: ${res.statusCode} from ${url}`);
        }
    });
});
