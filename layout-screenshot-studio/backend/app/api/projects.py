from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.dependencies import get_current_user, get_layout, get_project, layout_file_query, require_editor
from app.models import LayoutFile, Project, User
from app.schemas.projects import ProjectCreateRequest
from app.services.audit import audit

router = APIRouter(tags=["projects"])


def project_payload(project: Project) -> dict:
    return {
        "id": project.id,
        "name": project.name,
        "description": project.description,
        "owner_id": project.owner_id,
        "created_at": project.created_at,
    }


@router.post("/projects", status_code=201)
def create_project(
    payload: ProjectCreateRequest,
    user: User = Depends(require_editor),
    db: Session = Depends(get_db),
) -> dict:
    project = Project(name=payload.name.strip(), description=payload.description.strip(), owner_id=user.id)
    db.add(project)
    db.flush()
    audit(db, user.id, "project.created", "project", project.id, {"name": project.name})
    db.commit()
    return project_payload(project)


@router.get("/projects")
def list_projects(user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> dict:
    query = select(Project)
    if user.role.lower() != "admin":
        query = query.where(Project.owner_id == user.id)
    projects = db.scalars(query.order_by(Project.created_at.desc())).all()
    return {
        "items": [project_payload(project) for project in projects],
        "total": len(projects),
    }


@router.get("/files")
def list_files(
    project_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    get_project(db, user, project_id)
    files = db.scalars(
        layout_file_query(db, user)
        .where(LayoutFile.project_id == project_id)
        .order_by(LayoutFile.created_at.desc())
    ).all()
    return {
        "items": [
            {
                "id": item.id,
                "filename": item.original_name,
                "project_id": item.project_id,
                "status": item.status,
                "size_bytes": item.size_bytes,
                "sha256": item.sha256,
                "dbu_um": item.dbu_um,
                "cell_count": item.cell_count,
                "created_at": item.created_at,
                "error_code": item.error_code,
                "error_message": item.error_message,
            }
            for item in files
        ],
        "total": len(files),
    }
