-- "Fríos": la pausa consciente del kanban (como en roalbaine.team).
-- Un socio o lead frío no se borra ni se pierde: se aparta del tablero para
-- que las columnas muestren solo lo trabajable, y vuelve con un click.
ALTER TABLE socios ADD COLUMN frio TEXT;        -- ISO: cuándo se enfrió
ALTER TABLE socios ADD COLUMN frio_por TEXT;    -- quién lo enfrió
ALTER TABLE leads ADD COLUMN frio TEXT;
ALTER TABLE leads ADD COLUMN frio_por TEXT;
