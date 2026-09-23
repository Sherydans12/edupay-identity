# ADR-0012: STAFF y resolución exacta de personal para DIE

Estado: aceptada para implementación (2026-09-23).

`STAFF` es tenant-scoped y sólo `TENANT_ADMIN` lo administra mediante el ciclo
de cuentas existente. Permite autenticarse, pero no concede capacidades docentes,
administrativas, financieras ni DIE.

Identity expone resolución S2S exacta por `institutionalUsername` usando el token
restringido de ADR-0010. Revalida actor, sesión, membership y tenant; el tenant no
proviene del navegador. Es elegible sólo una membership ACTIVE de usuario/tenant
activos con `STAFF`, `TEACHER` o `TENANT_ADMIN`, y sin `STUDENT` ni
`GUARDIAN`. Roles de otras memberships son irrelevantes. Desconocido, inactivo,
inelegible y cross-tenant producen la misma respuesta; no hay listado ni búsqueda
parcial.

La respuesta exitosa contiene IDs opacos, username normalizado, estado y roles.
El username puede ser información personal: no aparece en logs, auditoría ni
errores. Se limita abuso por origen, sesión y huella irreversible del username.
Académico lo usa sólo como etiqueta capturada; autorización usa IDs opacos y
membership exacta. Cambios de username no transfieren acceso, revocación o pérdida
de rol lo corta, y una membership nueva no hereda DIE.
