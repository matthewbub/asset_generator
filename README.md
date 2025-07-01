# Asset Generator


Generate AI images via CLI with via the OpenAI API

https://github.com/user-attachments/assets/00692ff5-a38e-4284-95f4-ff8966137f06

> Disclaimer: I trimed the loading segments, this demo does not reflect actual loading times 


## Setup

```bash
git clone https://github.com/matthewbub/asset_generator
cd asset_generator
pnpm install
cp .env.example .env  # add your OpenAI API key
```

## Run

```bash
pnpm dev
```

or build for an executable

```bash
pnpm run build

chmod +x ./index.js

./index.js
```
