import fs from 'fs';
import { Queue, Worker, Job } from 'bullmq';
import axios from 'axios';
import dotenv from 'dotenv';
import { parse, differenceInMilliseconds } from 'date-fns';

dotenv.config();

const connection = { host: 'localhost', port: 6379 };

// Creamos la Fila
const aiQueue = new Queue('mensajes-ia', { connection });

// El Orquestador con Fallback
async function enviarConFallback(prompt: string, modelos: string[]) {
    for (const model of modelos) { // <--- Aquí estaba el error del nombre
        try {
            console.log(`📡 Intentando con: ${model}...`);
            const respuesta = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
                model: model,
                messages: [{ role: 'user', content: prompt }]
            }, {
                headers: { 
                    'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
                    'HTTP-Referer': 'http://localhost:3000',
                }
            });
            // Usamos 'model' que es la variable del bucle
            return { model, texto: respuesta.data.choices[0].message.content };
        } catch (error: any) {
            console.error(`⚠️ ${model} falló. Error:`, error.response?.data || error.message);
        }
    }
    throw new Error("❌ Ninguna IA pudo responder.");
}

// El Trabajador (Worker) con tipo explícito para 'job'
const worker = new Worker('mensajes-ia', async (job: Job) => {
    console.log(`📦 Procesando tarea: ${job.id}`);
    const resultado = await enviarConFallback(job.data.prompt, job.data.modelos);
    
    // --- NUEVA LÓGICA PARA GUARDAR EN ARCHIVO ---
    const nombreArchivo = `respuesta-${job.id}.txt`;
    const contenido = `MODELO: ${resultado.model}\nPROMPT: ${job.data.prompt}\n\nRESPUESTA:\n${resultado.texto}`;
    
    fs.writeFileSync(nombreArchivo, contenido);
    // --------------------------------------------

    console.log(`✅ ¡Éxito! Archivo ${nombreArchivo} creado.`);
}, { connection });

// Función para agendar
async function agendarMensaje(mensaje: string, fechaDestino: string | number) {
    let delay = 0;

    if (typeof fechaDestino === 'string') {
        // Intentamos entender formatos como "2023-12-31 23:59"
        // Si no se pasa fecha, asumimos que es un número de ms
        const ahora = new Date();
        const objetivo = parse(fechaDestino, 'yyyy-MM-dd HH:mm', ahora);
        delay = differenceInMilliseconds(objetivo, ahora);

        if (delay < 0) {
            console.error("❌ Error: La fecha ya pasó.");
            return;
        }
    } else {
        delay = fechaDestino;
    }

    await aiQueue.add('tarea-ia', 
        { 
            prompt: mensaje, 
            modelos: [
                'google/gemini-2.0-flash-lite-preview-02-05:free',
                'meta-llama/llama-3.2-3b-instruct:free',
                'openrouter/auto'
            ] 
        }, 
        { 
            delay: delay,
            attempts: 5,
            backoff: { type: 'exponential', delay: 10000 }
        }
    );
    console.log(`🕒 Mensaje agendado para ejecutarse en ${delay / 1000} segundos...`);
}

// Lógica para capturar argumentos de la terminal
const promptUser = process.argv[2];
const tiempoUser = process.argv[3]; // Ejemplo: "2025-05-20 15:30" o solo un número

if (promptUser) {
    // Si pasas un tiempo lo usa, si no, lo lanza en 1 segundo
    agendarMensaje(promptUser, tiempoUser || 1000);
}

// Detectar si el usuario pasó un mensaje por terminal
const userPrompt = process.argv[2]; 

if (userPrompt) {
    agendarMensaje(userPrompt, 1000); // Lo agenda para dentro de 1 segundo
} else {
    console.log("💡 Uso: npx tsx src/index.ts \"Tu mensaje aquí\"");
}