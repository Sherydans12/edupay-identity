# Publicar la imagen runtime de Identity

La publicación del runtime se realiza manualmente desde GitHub Actions. El flujo
usa `GITHUB_TOKEN`; no requiere Docker instalado en el computador del operador,
un PAT, ni credenciales locales de GHCR. Publicar la imagen no despliega ni
reinicia Coolify.

## Publicar

1. Abre **Actions → Publish Identity runtime → Run workflow** en el repositorio
   `Sherydans12/edupay-identity`.
2. Selecciona la rama `main` y ejecuta **Run workflow**. El flujo rechaza otras
   ramas y construye el SHA exacto del evento.
3. Espera que el flujo termine correctamente. Construye el target Docker
   `runtime` para `linux/amd64`, publica el tag del SHA y valida el digest, los
   metadatos, provenance, SBOM y artefactos de arranque.
4. Copia `IDENTITY_RUNTIME_IMAGE` desde el log final o la sección **Summary**.
   La referencia tiene este formato:

   ```text
   ghcr.io/sherydans12/edupay-identity@sha256:<digest>
   ```

   Usa esa referencia por digest en Coolify para desplegar exactamente el
   artefacto validado. El tag por SHA ayuda a localizar la versión publicada.

   No uses el digest que aparece en la lista **Artifacts** junto a un archivo
   `.dockerbuild`: ese valor identifica el archivo de diagnóstico de Buildx,
   no la imagen runtime.

## Desplegar en Coolify

1. Edita la imagen del recurso **Identity** y reemplázala por la referencia por
   digest obtenida del workflow.
2. Guarda los cambios y redeploya **Identity**.
3. Comprueba que quede saludable y revisa los logs del servicio.

Este flujo no publica ni ejecuta el contenedor **Identity Migrate**. Solo se
debe ejecutar una migración cuando el cambio incluya una migración Prisma y se
haya preparado su procedimiento correspondiente.

## Acceso de GitHub Packages

El job recibe `packages: write` mediante el `GITHUB_TOKEN` del repositorio. Si
GHCR devuelve `denied` o `permission_denied`, revisa en la configuración del
paquete `edupay-identity` que el repositorio `EduPayIdentity` tenga permiso de
escritura para Actions. No uses la contraseña de la cuenta GitHub como clave de
`docker login`.
