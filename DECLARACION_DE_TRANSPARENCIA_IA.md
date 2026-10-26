# Declaración de Transparencia sobre el Uso de IA

## 1. La verdad

Usé la IA de forma extensiva durante este proceso. Mucho más de lo que me gustaría admitir.

No fue solo a modo de copiloto, sino que en muchas actividades fue quien escribió gran parte del código, los scripts y la documentación, mientras yo le daba dirección, revisaba, ajustaba, probaba y validaba.

## 2. Desglose real por actividad

| Actividad | Nivel de uso | Explicación |
| :-- | :-- | :-- |
| **Comprensión inicial** | Alto (60-70%) | Me ayudó a orientarme por el repositorio más rápido. Aun así, terminé leyendo los archivos clave yo mismo para poder entenderlos. |
| **Auditoría contra el enunciado** | Alto (70-80%) | Me dio la lista base de hallazgos cruzando el código con el enunciado y con la evaluación. Tuve que filtrar, descartar falsos positivos y validar cada uno contra el código real. |
| **Correcciones de código** | Muy alto (80-90%) | Se detectaba el problema, se lo describía a la IA, ella me proponía la solución y yo la leía, ajustaba, entendía y aplicaba. Hubo muy pocos cambios que escribí 100% yo desde cero. |
| **Scripts de pruebas y stress tests** | Extremadamente alto (95%) | Casi todos los scripts de auditoría, las permutaciones, los tests con 2000, 7500 y el de 7000 siguiendo la especificación, fueron generados por la IA. Yo únicamente decía que quería probar, los ejecutaba, veía el resultado y pedía ajustes. |
| **Debugging** | Mixto (50-60%) | Muchas veces lo hice yo mirando logs, la base de datos o las respuestas HTTP. Otras veces, cuando me quedaba completamente atascado, le pegaba el error directamente para que me ayudara a encontrar el camino. |
| **Documentación** | Muy alto (85-90%) | La gran mayoría fue escrita por la IA con mi guía. Yo reescribí, corté, cambié y adapté todo para que fuera veraz con lo que realmente hice, probé y entendí. |

## 3. Lo más honesto

- **Escribí poco código directo.** Si me preguntas cuántas líneas escribí yo a mano desde cero, serían muy pocas. La gran mayoría las generé con la IA bajo mi dirección.
- **Delegué la escritura, no la responsabilidad.** Aunque no tipeé la mayor parte, yo fui quien decidió qué corregir, qué probar, qué dejar y qué era correcto o no. Todo lo que quedó aplicado fue revisado por mí antes de aceptarlo.
- **Entiendo lo que hay, pero no lo habría escrito solo.** Puedo explicar perfectamente los advisory locks, `FOR UPDATE SKIP LOCKED`, `SAVEPOINT`, la máquina de estados, los diferidos, idempotencia, el ledger inmutable y cada corrección aplicada. Sin embargo, si hoy me pidieran reescribir este mismo proyecto desde cero sin IA, me costaría muchísimo.
- **Me apoyé en ella para pensar.** En más de una ocasión, en vez de sentarme a razonar por horas, le preguntaba "¿ves algo raro aquí?" y me daba ideas que yo después validaba. Ahí sí fue más que un asistente, fue un sparring constante.
- **Sin IA, este entregable no se parecería en nada a lo que es ahora.** Los scripts de stress, la batería de pruebas tan exhaustiva y gran parte de las correcciones no las habría hecho. Simplemente no me habría dado el tiempo para escribirlos todo yo.

## Conclusión

**Sí, usé la IA para escribir gran parte de esto. Pero revisé, probé, entendí y validé todo lo que entregué.**

Fui el que levantó el proyecto, corrí los tests, ejecuté los stress tests, analicé los resultados, tomé las decisiones y me aseguré de que funcionara.

Siendo completamente sincero: delegué la escritura, pero nunca delegué el control ni la validación. A pesar de eso, lo correcto es admitirlo tal cual es. Usé la IA extensivamente, con dirección activa, y este proyecto refleja eso.
