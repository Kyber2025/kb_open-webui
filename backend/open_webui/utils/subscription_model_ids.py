"""Model identity shared by subscription configuration, preview and enforcement."""


def canonical_model_id(value: str) -> str:
    return value.strip().lower().split('/', 1)[-1]


def normalize_model_ids(values):
    if values is None:
        return None
    result = list(dict.fromkeys(canonical_model_id(value) for value in values))
    if any(not value for value in result):
        raise ValueError('Model ids cannot be blank')
    return result
