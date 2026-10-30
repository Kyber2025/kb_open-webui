"""Claude in Kividas Chat searches through native tool calls, with web search as the only builtin.

Native function calling hands the model owui's builtin tools instead of running the forced
per-message handlers. Kividas offers only the web search category by default, so every other
feature (memory, image generation, code interpreter) must keep its forced handler when its
tools are not offered. Runs on the standard library alone: the helper is lifted from its
module, the middleware wiring is checked in its source."""
import ast
import os
import re
import unittest
from pathlib import Path
from types import ModuleType
from typing import Optional
from unittest.mock import patch

ROOT = Path(__file__).parents[1] / 'open_webui'
NAMES = {'KIVIDAS_BUILTIN_TOOLS', 'KIVIDAS_CHAT_TOOLS_PROMPT', 'is_builtin_category_enabled'}


def lift_tools() -> ModuleType:
    tree = ast.parse((ROOT / 'utils/tools.py').read_text())
    nodes = [
        node
        for node in tree.body
        if (isinstance(node, ast.FunctionDef) and node.name in NAMES)
        or (isinstance(node, ast.Assign) and any(getattr(t, 'id', None) in NAMES for t in node.targets))
    ]
    module = ModuleType('isolated_tools')
    module.__dict__.update(os=os, Optional=Optional)
    exec(compile(ast.Module(body=nodes, type_ignores=[]), 'tools.py', 'exec'), module.__dict__)
    assert NAMES <= set(module.__dict__), NAMES - set(module.__dict__)
    return module


def model(**builtin_tools):
    return {'info': {'meta': {'builtinTools': builtin_tools}}} if builtin_tools else {'info': {'meta': {}}}


class BuiltinCategories(unittest.TestCase):
    def test_only_web_search_by_default(self):
        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop('KIVIDAS_BUILTIN_TOOLS', None)
            tools = lift_tools()
        self.assertTrue(tools.is_builtin_category_enabled(model(), 'web_search'))
        for category in ('time', 'knowledge', 'chats', 'memory', 'notes', 'tasks', 'image_generation', 'code_interpreter'):
            self.assertFalse(tools.is_builtin_category_enabled(model(), category), category)
        self.assertTrue(tools.is_builtin_category_enabled(None, 'web_search'))
        self.assertTrue(tools.is_builtin_category_enabled({'info': None}, 'web_search'))

    def test_model_settings_win(self):
        tools = lift_tools()
        self.assertTrue(tools.is_builtin_category_enabled(model(time=True), 'time'))
        self.assertFalse(tools.is_builtin_category_enabled(model(web_search=False), 'web_search'))

    def test_environment_widens_the_default(self):
        with patch.dict(os.environ, {'KIVIDAS_BUILTIN_TOOLS': 'web_search, memory'}):
            tools = lift_tools()
        self.assertTrue(tools.is_builtin_category_enabled(model(), 'memory'))
        self.assertFalse(tools.is_builtin_category_enabled(model(), 'notes'))
        with patch.dict(os.environ, {'KIVIDAS_BUILTIN_TOOLS': '*'}):
            tools = lift_tools()
        self.assertTrue(tools.is_builtin_category_enabled(model(), 'notes'))

    def test_chat_prompt_names_the_tools(self):
        prompt = lift_tools().KIVIDAS_CHAT_TOOLS_PROMPT
        self.assertIn('search_web', prompt)
        self.assertIn('not a coding tool', prompt)


class MiddlewareWiring(unittest.TestCase):
    source = (ROOT / 'utils/middleware.py').read_text()

    def test_forced_handlers_yield_only_to_offered_tools(self):
        for category, handler in (
            ('memory', 'chat_memory_handler'),
            ('web_search', 'chat_web_search_handler'),
            ('image_generation', 'chat_image_generation_handler'),
        ):
            guard = re.search(rf"if not native_tool\('{category}'\)[^\n]*:\n\s+form_data = await {handler}\(", self.source)
            self.assertIsNotNone(guard, category)
        self.assertIn("if not native_tool('code_interpreter'):", self.source)
        self.assertNotIn("function_calling') != 'native':\n                form_data = await chat_", self.source)

    def test_chat_prompt_rides_with_the_search_tool(self):
        self.assertRegex(
            self.source,
            r"if 'search_web' in builtin_tools:\n\s+form_data\['messages'\] = add_or_update_system_message\(\n\s+KIVIDAS_CHAT_TOOLS_PROMPT,",
        )


if __name__ == '__main__':
    unittest.main()
