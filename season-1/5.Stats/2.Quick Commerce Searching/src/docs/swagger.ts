import swaggerJsdoc from "swagger-jsdoc";

export const swaggerSpec = swaggerJsdoc({
  definition: {
    openapi: "3.0.0",
    info: {
      title: "Quick Commerce Search API",
      version: "1.0.0",
      description: "Multilingual hybrid search (Typesense + Ollama), product pipeline on Kafka, analytics. Admin routes need the x-admin-key header.",
    },
    servers: [{ url: "/" }],
    components: {
      securitySchemes: {
        adminKey: { type: "apiKey", in: "header", name: "x-admin-key" },
      },
    },
  },
  apis: ["./src/**/*.router.ts"],
});
