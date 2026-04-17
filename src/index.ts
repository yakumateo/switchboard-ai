import fs from 'fs';
import { Queue, Worker, Job } from 'bullmq';
import axios from 'axios';
import dotenv from 'dotenv';
import { parse, differenceInMilliseconds } from 'date-fns';

import express from 'express';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';

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
async function agendarMensaje(mensaje: string, tiempoRecibido: string | undefined) {
    let delay = 1000; // Por defecto 1 segundo

    if (tiempoRecibido) {
        // Intentamos convertir a número
        const numeroSueltos = parseInt(tiempoRecibido);

        if (!isNaN(numeroSueltos)) {
            // Si el usuario puso un número (ej: 5000), lo usamos directamente
            delay = numeroSueltos;
        } else {
            // Si no es un número, intentamos parsear como fecha (AAAA-MM-DD HH:mm)
            try {
                const ahora = new Date();
                const objetivo = parse(tiempoRecibido, 'yyyy-MM-dd HH:mm', ahora);
                const diferencia = differenceInMilliseconds(objetivo, ahora);
                
                // Si la fecha es válida y es futura, usamos la diferencia
                if (!isNaN(diferencia) && diferencia > 0) {
                    delay = diferencia;
                }
            } catch (e) {
                console.warn("⚠️ No se pudo entender el tiempo. Usando ejecución inmediata.");
                delay = 1000;
            }
        }
    }

    // SEGURIDAD FINAL: Si por alguna razón delay sigue siendo NaN, forzamos 1000
    const finalDelay = isNaN(delay) ? 1000 : delay;

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
            delay: finalDelay, // Enviamos un número garantizado
            attempts: 5,
            backoff: { type: 'exponential', delay: 10000 }
        }
    );
    
    console.log(`🕒 Tarea agendada para ejecutarse en ${finalDelay / 1000} segundos.`);
}

// 1. Crear el adaptador de Express
const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath('/admin/queues');

// 2. Configurar BullBoard con tu cola actual
createBullBoard({
  queues: [new BullMQAdapter(aiQueue)],
  serverAdapter: serverAdapter,
});

const app = express();

// 3. Conectar el router del dashboard
app.use('/admin/queues', serverAdapter.getRouter());

app.listen(3000, () => {
  console.log('----------------------------------------------------');
  console.log('🚀 MONITOR ACTIVO v7.0.0');
  console.log('🔗 Revisa tus mensajes aquí: http://localhost:3000/admin/queues');
  console.log('----------------------------------------------------');
});

// --- BLOQUE FINAL DE EJECUCIÓN ---
// Solo debe haber uno de estos al final de tu archivo

const promptUser = process.argv[2];
const tiempoUser = process.argv[3]; // Esto viene como string desde la terminal

if (promptUser) {
    // Pasamos el tiempo directamente como string o undefined
    agendarMensaje(promptUser, tiempoUser);
} else {
    console.log('💡 Uso: npm run ask "Tu mensaje" 5000');
}