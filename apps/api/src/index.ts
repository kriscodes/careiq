import express from "express"

const app = express();

const port = Number(process.env.PORT ?? 3000);

app.use(express.json());

app.get("/health", (_req, res) => {
    res.status(200).json({
        status: "ok",
        service: "careiq-api",
    })
})

app.listen(port, () => {
    console.log(`CareIQ API listening on port ${port}.`);
});